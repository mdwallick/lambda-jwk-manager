const jwkToPem = require("jwk-to-pem")
const { ManagementClient } = require("auth0")

exports.handler = async (event) => {
  try {
    const { client_id, jwk } = JSON.parse(event.body)

    if (!client_id || !jwk) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing client_id or jwk" }),
      }
    }

    const pem = jwkToPem(jwk)

    const auth0 = new ManagementClient({
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      scope: "create:client_credentials update:clients read:clients",
    })

    const cred_data = {
      name: `credential-for-${client_id}`,
      credential_type: "public_key",
      alg: "RS256", // must be one of RS256, RS384, PS256
      pem,
    }

    const credential = await auth0.clients.createCredential(
      { client_id: client_id },
      cred_data
    )

    const client_data = {
      client_authentication_methods: {
        private_key_jwt: {
          credentials: [
            {
              id: credential.data.id,
            },
          ],
        },
      },
    }

    console.log("CREATED CREDENTIAL", credential.data.id)
    await auth0.clients.update({ client_id: client_id }, client_data)

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Credential created and linked",
        credential_id: credential.data.id,
        client_id,
      }),
    }
  } catch (err) {
    console.error(err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
