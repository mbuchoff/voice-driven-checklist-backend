import type { APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';

export function handler(
  event: unknown,
  context: Context,
): APIGatewayProxyStructuredResultV2 {
  void event;
  void context;

  return {
    body: JSON.stringify({ status: 'ok' }),
    headers: {
      'content-type': 'application/json',
    },
    statusCode: 200,
  };
}
