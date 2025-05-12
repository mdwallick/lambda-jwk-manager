const { ManagementClient } = require("auth0")
const axios = require("axios")
const crypto = require("crypto")
const jwkToPem = require("jwk-to-pem")

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager")

const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} = require("@aws-sdk/client-dynamodb")

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION })

exports.handler = async (event) => {
  try {
    const secretName = process.env.AUTH0_CLIENT_SECRET_NAME
    const auth0ClientSecret = await getAuth0ClientSecret(secretName)

    const auth0 = new ManagementClient({
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: auth0ClientSecret,
      scope: "create:client_credentials update:clients read:clients",
    })

    const clients = (await auth0.clients.getAll()) || []

    const results = []

    for (const client of clients.data) {
      const client_id = client.client_id
      const jwksUri = client?.client_metadata?.jwks_uri

      if (!jwksUri) {
        console.info(`jwks_uri is empty for client ${client_id}: skipping.`)
        continue
      }

      if (!jwksUri.startsWith("https://")) {
        console.error(
          `jwks_uri must start with 'https://' for client ${client_id}`
        )
        continue
      }

      console.info(`Fetching JWK from ${jwksUri} for client ${client_id}`)

      try {
        const { jwks, isFresh } = await getCachedOrFreshJwks(client_id, jwksUri)

        if (!isFresh) {
          console.info(
            `Cached JWKS still valid for client ${client_id}, skipping update.`
          )
          continue
        }

        const jwk = jwks.keys[0]
        const pem = jwkToPem(jwk)

        const cred_data = {
          name: `credential-for-${jwk.kid}`,
          credential_type: "public_key",
          alg: "RS256",
          pem,
        }

        const credential = await auth0.clients.createCredential(
          { client_id },
          cred_data
        )

        const client_metadata = {
          kid: jwk.kid,
        }

        const client_data = {
          client_metadata,
          client_authentication_methods: {
            private_key_jwt: {
              credentials: [{ id: credential.data.id }],
            },
          },
        }

        await auth0.clients.update({ client_id }, client_data)

        results.push({
          client_id,
          credential_id: credential.data.id,
        })

        console.log(
          `Created and linked credential ${credential.data.id} for client ${client_id}`
        )
      } catch (innerErr) {
        console.error(
          `Failed processing client ${client_id}:`,
          innerErr.message
        )
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Processed clients with jwks_uri",
        results,
      }),
    }
  } catch (err) {
    console.error("Fatal error:", err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}

async function getCachedOrFreshJwks(clientId, jwksUri) {
  const key = getHashKey(jwksUri)
  const now = Date.now()

  try {
    const cached = await dynamo.send(
      new GetItemCommand({
        TableName: process.env.JWK_MANAGER_TABLE_NAME,
        Key: {
          key: { S: key },
        },
      })
    )

    const cachedItem = cached.Item
    if (
      cachedItem &&
      cachedItem.expiresAt &&
      new Date(cachedItem.expiresAt.S).getTime() > now
    ) {
      return {
        jwks: JSON.parse(cachedItem.jwks.S),
        isFresh: false,
      }
    }
  } catch (err) {
    console.warn(`DynamoDB lookup failed for key ${key}:`, err.message)
  }

  const { data: jwks, headers } = await axios.get(jwksUri)

  if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error(`No JWKS found at ${jwksUri}`)
  }

  let expiresAt = new Date(now + 5 * 60 * 1000)
  const cacheControl = headers["cache-control"]
  if (cacheControl?.includes("max-age")) {
    const match = cacheControl.match(/max-age=(\d+)/)
    if (match) {
      expiresAt = new Date(now + parseInt(match[1], 10) * 1000)
    }
  } else if (headers["expires"]) {
    expiresAt = new Date(headers["expires"])
  }

  await dynamo.send(
    new PutItemCommand({
      TableName: process.env.JWK_MANAGER_TABLE_NAME,
      Item: {
        key: { S: key },
        uri: { S: jwksUri },
        jwks: { S: JSON.stringify(jwks) },
        expiresAt: { S: expiresAt.toISOString() },
        clientId: { S: clientId },
        ttl: { N: Math.floor(expiresAt.getTime() / 1000).toString() },
      },
    })
  )

  return {
    jwks,
    isFresh: true,
  }
}

function getHashKey(uri) {
  return crypto.createHash("sha256").update(uri).digest("hex")
}

async function getAuth0ClientSecret(secretName) {
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  })
  const command = new GetSecretValueCommand({ SecretId: secretName })
  const response = await client.send(command)

  if (response.SecretString) {
    const secret = JSON.parse(response.SecretString)
    return secret.AUTH0_CLIENT_SECRET
  } else {
    throw new Error("SecretString is empty or not available.")
  }
}
