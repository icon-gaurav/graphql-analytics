import http from 'http';

/**
 * Auto-fires sample GraphQL queries to the test server.
 * Run this while the test server is running to generate traffic.
 * Watch collector metrics: curl http://localhost:9001
 * Watch dashboard: http://localhost:3000
 */

const SERVER_URL = `http://${process.env.SERVER_HOST || 'localhost'}:${
  process.env.SERVER_PORT || '4000'
}/graphql`;

const queries = [
  {
    name: 'GetUser',
    query: `query GetUser {
      user(id: "1") {
        id
        name
        email
        posts {
          id
          title
        }
      }
    }`,
  },
  {
    name: 'ListUsers',
    query: `query ListUsers {
      users {
        id
        name
        email
      }
    }`,
  },
  {
    name: 'ListPosts',
    query: `query ListPosts {
      posts {
        id
        title
        author {
          id
          name
          email
        }
      }
    }`,
  },
  {
    name: 'GetPost',
    query: `query GetPost {
      post(id: "1") {
        id
        title
        content
        author {
          name
          email
        }
      }
    }`,
  },
  {
    name: 'HealthCheck',
    query: `query {
      health
    }`,
  },
];

async function sendQuery(query: string, operationName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, operationName });

    const options: http.RequestOptions = {
      hostname: SERVER_URL.split('/')[2].split(':')[0],
      port: parseInt(SERVER_URL.split(':').pop() || '4000'),
      path: '/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log(`  [${operationName}] ✓ ${res.statusCode}`);
        resolve();
      });
    });

    req.on('error', (err) => {
      console.error(`  [${operationName}] ✗ Error:`, err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log(`\n📡 Firing sample queries to ${SERVER_URL}\n`);
  console.log(`   (Watch collector metrics: curl http://localhost:9001)`);
  console.log(`   (Watch dashboard: http://localhost:3000)\n`);

  for (let round = 0; round < 3; round++) {
    console.log(`Round ${round + 1}:`);
    for (const { name, query } of queries) {
      await sendQuery(query, name);
      await new Promise((r) => setTimeout(r, 200)); // stagger requests
    }
    console.log();
    if (round < 2) {
      await new Promise((r) => setTimeout(r, 1000)); // wait before next round
    }
  }

  console.log('✓ Test complete! Check dashboard in ~60 seconds for aggregated results.\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

