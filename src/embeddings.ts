export type EmbeddingClient = {
  embed(input: string): Promise<number[]>;
};

type OpenAIEmbeddingClientOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
};

type OpenAIEmbeddingResponse = {
  data?: Array<{
    embedding?: unknown;
  }>;
};

export function createOpenAIEmbeddingClient({
  apiKey,
  model,
  baseUrl = 'https://api.openai.com/v1'
}: OpenAIEmbeddingClientOptions): EmbeddingClient {
  return {
    async embed(input: string): Promise<number[]> {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input,
          model
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI embeddings request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as OpenAIEmbeddingResponse;
      const embedding = payload.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === 'number')) {
        throw new Error('OpenAI embeddings response did not include a numeric embedding');
      }

      return embedding;
    }
  };
}
