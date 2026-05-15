import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { gql } from 'graphql-tag';
import { GraphQLAnalyticsPlugin } from '@graphql-analytics/sdk';

// Sample GraphQL schema
const typeDefs = gql`
  type Query {
    user(id: ID!): User
    users: [User!]!
    post(id: ID!): Post
    posts: [Post!]!
    health: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    posts: [Post!]!
  }

  type Post {
    id: ID!
    title: String!
    content: String!
    author: User!
  }
`;

// Sample resolvers with simulated delays
const resolvers = {
  Query: {
    user: async (_: unknown, { id }: { id: string }) => {
      await sleep(10);
      return { id, name: 'John Doe', email: 'john@example.com' };
    },
    users: async () => {
      await sleep(5);
      return [
        { id: '1', name: 'John Doe', email: 'john@example.com' },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com' },
      ];
    },
    post: async (_: unknown, { id }: { id: string }) => {
      await sleep(15);
      return { id, title: 'Test Post', content: 'Sample content' };
    },
    posts: async () => {
      await sleep(8);
      return [
        { id: '1', title: 'First Post', content: 'Content 1' },
        { id: '2', title: 'Second Post', content: 'Content 2' },
      ];
    },
    health: () => 'ok',
  },

  User: {
    posts: async (user: { id: string }) => {
      await sleep(12);
      return [
        { id: '1', title: 'User Post', content: 'User content', authorId: user.id },
      ];
    },
  },

  Post: {
    author: async (post: { authorId?: string }) => {
      await sleep(8);
      return { id: post.authorId || '1', name: 'Author', email: 'author@example.com' };
    },
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [
      GraphQLAnalyticsPlugin({
        serviceName: 'test-graphql-server',
        collectorUrl: process.env.GRAPHQL_ANALYTICS_COLLECTOR_URL || 'http://localhost:4318',
        metricsIntervalMs: parseInt(process.env.GRAPHQL_ANALYTICS_METRICS_INTERVAL || '30000'),
        enabled: process.env.GRAPHQL_ANALYTICS_ENABLED !== 'false',
      }),
    ],
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: parseInt(process.env.PORT || '4000') },
  });

  console.log(`✓ Test server ready at ${url}`);
  console.log(`✓ OpenTelemetry enabled: sending traces/metrics to ${process.env.GRAPHQL_ANALYTICS_COLLECTOR_URL || 'http://localhost:4318'}`);
  console.log(`\n📝 Sample queries:\n`);
  console.log(`  # Get user with posts`);
  console.log(`  query { user(id: "1") { id name email posts { id title } } }\n`);
  console.log(`  # Get all posts`);
  console.log(`  query { posts { id title author { name } } }\n`);
  console.log(`  # Run: npm run test:queries (from this directory)\n`);
}

startServer().catch(console.error);


