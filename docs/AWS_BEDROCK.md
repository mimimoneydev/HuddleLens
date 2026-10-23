# Amazon Bedrock production setup

HuddleLens invokes Amazon Nova 2 Lite through the Bedrock Runtime `Converse` API. The server requests schema-constrained JSON and automatically retries with prompt-constrained JSON when a region/runtime does not accept structured-output parameters.

## Runtime configuration

```bash
export AI_PROVIDER=auto
export AWS_REGION=us-east-1
export BEDROCK_DEFAULT_MODEL=global.amazon.nova-2-lite-v1:0
```

Do not put AWS keys in browser assets, `runtime-config.js`, or the Vega package. In ECS, EKS, Lambda, or EC2, attach an IAM workload role. For local development, the AWS SDK can use an AWS profile, IAM Identity Center session, or standard AWS environment credentials.

Before deployment, confirm that Nova 2 Lite is available for the account and region and that cross-region inference is permitted by organizational policies.

## IAM permission

This bootstrap policy grants only inference actions, but uses a wildcard resource because inference-profile and routed foundation-model ARNs can vary by account and region. Replace `*` with the exact inference-profile and foundation-model ARNs shown by Bedrock for the deployment after the first successful validation.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeHuddleLensNova",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*"
    }
  ]
}
```

HuddleLens currently uses non-streaming `Converse`; `InvokeModelWithResponseStream` is included only for a future streaming UI and may be removed for stricter least privilege.

## Optional guardrail

Create a Bedrock Guardrail and set both variables:

```bash
export BEDROCK_GUARDRAIL_ID=your-guardrail-id
export BEDROCK_GUARDRAIL_VERSION=1
```

The adapter adds the guardrail to every Converse request. If either variable is absent, guardrails are not attached.

## Validation

1. Start the server with the environment above.
2. Request `GET /api/health`; `ai.primaryProvider` must be `bedrock` and the configured Bedrock model must be present.
3. Generate an explanation and verify the response reports `provider: "bedrock"`.
4. Deny Bedrock temporarily in a staging role and verify auto mode reports `provider: "openrouter"` with a failed Bedrock attempt followed by a successful OpenRouter attempt.
5. Review CloudTrail and application telemetry for invocation failures and latency. Never log credentials or full provider responses.

The `/api/explain` response includes provider attempts and durations without exposing secrets. `/api/health` exposes the latest provider error for operational checks; keep that endpoint behind the same trusted application boundary in production.
