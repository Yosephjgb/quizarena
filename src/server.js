import { createApp } from './app.js';
import { config } from './config.js';

const { server, close } = createApp();

server.listen(config.port, () => {
  console.log(`QuizArena running on http://localhost:${config.port}`);
});

// Graceful shutdown (Docker / Render send SIGTERM).
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await close();
    process.exit(0);
  });
}
