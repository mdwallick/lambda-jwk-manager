# Lambda JWK Manager

## Overview

This project contains a Lambda function that interacts with Auth0, fetches JSON Web Keys (JWKs)
from URIs configured in Auth0 client metadata, and generates credentials for each client in your
Auth0 account. The function is designed to be easy to configure and deploy using the Serverless Framework.

## Prerequisites

Before you can deploy and use this project, make sure you have the following:

1. **Node.js** and **npm** installed. You can check if Node.js is installed by running:

   ```bash
   node -v
   ```

If it’s not installed, you can download it from [here](https://nodejs.org/).

2. **Serverless Framework** installed globally. You can install it by running:

   ```bash
   npm install -g serverless
   ```

3. **AWS CLI** configured with access to your AWS account. You can configure it by running:

   ```bash
   aws configure
   ```

4. **AWS Secrets Manager** permissions set up to store sensitive values such as `AUTH0_CLIENT_SECRET`.

## Setup

1.  Clone the Repository

    Clone the repository and navigate to the project directory:

    ```bash
    git clone https://github.com/mdwallick/lambda-jwk-manager.git
    cd lambda-jwk-manager
    ```

2.  Install Dependencies

    Install the required npm dependencies:

    ```bash
    npm install
    ```

3.  Create AWS Secret for `AUTH0_CLIENT_SECRET`

    You need to create a secret in AWS Secrets Manager to securely store the `AUTH0_CLIENT_SECRET`.

    This secret will be accessed by the Lambda function at runtime.

    Create your secret using the AWS CLI. Replace region with your region name.

    ```bash
    aws secretsmanager create-secret \
      --name {your secret name} \
      --description "Auth0 Client Secret for jwk-manager Lambda" \
      --secret-string '{"AUTH0_CLIENT_SECRET":"your client secret"}' \
      --region us-east-1
    ```

    You can verify the secret was created with this command:

    ```bash
    aws secretsmanager get-secret-value \
      --secret-id {your secret name} \
      --region us-east-1
    ```

4.  Configure `.env` File

    In the project directory, copy `.env.example` to `.env` file and fill in the following environment variables:

    ```ini
    AUTH0_DOMAIN=your-auth0-domain
    AUTH0_CLIENT_ID=your-client-id
    AUTH0_CLIENT_SECRET_NAME=your-secret-name
    ```

5.  Deploy the Service

    Deploy the service to AWS using the Serverless Framework:

    ```bash
    serverless deploy --region us-east-1
    ```

    This will:

    - Create the necessary IAM roles for your Lambda function.
    - Deploy the Lambda function to AWS.
    - Set up API Gateway and other resources.
    - Access the secret from AWS Secrets Manager during runtime.

    After deployment, you will receive an API Gateway URL where you can test the deployed service.

## Using the Service

Once the service is deployed, it will expose an HTTP endpoint. You can call this endpoint with a POST request to trigger the Lambda function.

### Test Locally with `serverless-offline`

If you want to test the Lambda function locally, you can use the `serverless-offline plugin`, which simulates AWS API Gateway locally.

1. Install the `serverless-offline` plugin:

   ```bash
   npm install --save-dev serverless-offline
   ```

2. Add the plugin to `serverless.yml`:

   ```yaml
   plugins:
     - serverless-dotenv-plugin
     - serverless-offline
   ```

3. Run the function locally:

   ```bash
   serverless offline start
   ```

   The function will be available at `http://localhost:3000/jwk-manager`.

## Automating Secret Creation and Deployment

To simplify the setup, you can create the secret in AWS Secrets Manager and deploy the service using a deployment script. Follow the steps below to automate the process:

### `deploy.sh` Script

Create a `deploy.sh` script to automate the setup and deployment process:

```bash
#!/bin/bash

# Ensure AWS CLI is configured

aws configure

# Create the secret in Secrets Manager if it doesn't exist

aws secretsmanager create-secret --name /my/secret/path --secret-string '{"AUTH0_CLIENT_SECRET": "your-secret-value"}' || echo "Secret already exists."

# Install dependencies

npm install

# Deploy with Serverless

serverless deploy
```

Run the script to automate secret creation and deployment:

```bash
./deploy.sh
```

## IAM Permissions

Ensure that the Lambda function has permissions to access AWS Secrets Manager. You can add the following IAM permissions in your `serverless.yml`:

```yaml
provider:
name: aws
runtime: nodejs18.x
iamRoleStatements:
  - Effect: "Allow"
    Action:
      - "secretsmanager:GetSecretValue"
    Resource: "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:/my/secret/path"
```

This will give your Lambda function the necessary permissions to read the secret.

## Troubleshooting

### Common Errors

- **Unauthorized (Access Denied)**: If you see this error, ensure that your Lambda function has the appropriate IAM permissions to access the AWS Secrets Manager secret.
- **Invalid Auth0 Domain or Client ID**: Double-check that your `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` are correctly set in your `.env` file or environment variables.

If you encounter any issues or need help, feel free to reach out via GitHub Issues or contact the maintainers.

## Contributing

Feel free to open issues and pull requests if you have suggestions for improvements or fixes.

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/mdwallick/lambda-jwk-manager/blob/main/LICENSE) file for details.
