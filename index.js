const { ManagementClient } = require("auth0")
const axios = require("axios")
const jwkToPem = require("jwk-to-pem")

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager")

exports.handler = async (event) => {
  try {
    const JWK_METADATA_KEY =
      process.env.JWK_METADATA_KEY || "jwks_uri_DO_NOT_DELETE"
    const EXPIRY_METADATA_KEY =
      process.env.EXPIRY_METADATA_KEY || "expires_at_DO_NOT_DELETE"
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
      const jwksUri = client?.client_metadata?.[JWK_METADATA_KEY]
      const expiresAtString = client?.client_metadata?.[EXPIRY_METADATA_KEY]

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
        const now = Date.now()
        const expiresAt = parseInt(expiresAtString, 10)
        if (!isNaN(expiresAt) && expiresAt > now) {
          console.info(
            `Cached JWKS still valid for client ${client_id}, skipping update.`
          )
          continue
        }

        const { data: jwks, headers } = await axios.get(jwksUri)

        if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
          throw new Error(`No JWKS found at ${jwksUri}`)
        }

        let expiry = new Date(now + 5 * 60 * 1000)
        const cacheControl = headers["cache-control"]

        if (cacheControl?.includes("max-age")) {
          const match = cacheControl.match(/max-age=(\d+)/)
          if (match) {
            expiry = new Date(now + parseInt(match[1], 10) * 1000)
          }
        } else if (headers["expires"]) {
          expiry = new Date(headers["expires"])
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

        const client_data = {
          client_metadata: {
            [EXPIRY_METADATA_KEY]: expiry.getTime().toString(),
          },
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
          expiresAt: expiry.getTime().toString(),
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
