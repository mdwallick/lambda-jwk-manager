const { ManagementClient } = require("auth0")
const axios = require("axios")
const jwkToPem = require("jwk-to-pem")
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager")

async function getAuth0ClientSecret(secretName) {
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  })
  const command = new GetSecretValueCommand({ SecretId: secretName })
  const response = await client.send(command)

  // Check if SecretString exists and parse it
  if (response.SecretString) {
    const secret = JSON.parse(response.SecretString)
    return secret.AUTH0_CLIENT_SECRET
  } else {
    throw new Error("SecretString is empty or not available.")
  }
}

exports.handler = async (event) => {
  try {
    const secretName = process.env.AUTH0_CLIENT_SECRET_SECRET_NAME
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
        const { data: jwks } = await axios.get(jwksUri)

        if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
          console.warn(`No JWKs found at ${jwksUri}`)
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
          key_id: jwk.kid,
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
