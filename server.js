// Local entrypoint: start an HTTP listener. (On Vercel, api/index.js is used
// instead and the platform provides the server.)
import app from "./app.js";
import { aiEnabled } from "./ai.js";
import { dbKind } from "./db.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n  Idea Parking Lot running at http://localhost:${PORT}`);
  console.log(`  Storage:     ${dbKind()}`);
  console.log(`  AI features: ${aiEnabled() ? "enabled (Fireworks)" : "disabled (set FIREWORKS_API_KEY to enable)"}\n`);
});
