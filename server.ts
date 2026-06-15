import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import Stripe from "stripe";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const isValidStripeKey = stripeKey && (stripeKey.startsWith('sk_test_') || stripeKey.startsWith('sk_live_'));
const stripe = isValidStripeKey ? new Stripe(stripeKey) : null;

if (stripeKey && !isValidStripeKey) {
  console.warn("Invalid STRIPE_SECRET_KEY format. Falling back to mock payments for development.");
}

const getAppUrl = (req: express.Request) => {
  if (process.env.APP_URL) return process.env.APP_URL;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['host'];
  return `${protocol}://${host}`;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite Database
const db = new Database("chefai.db");
db.pragma('foreign_keys = ON');

// Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    photo_url TEXT,
    preferred_cuisine TEXT DEFAULT 'Mediterranean',
    taste_dna TEXT DEFAULT '{"sweetness": 50, "saltiness": 50, "spiciness": 50, "umami": 50, "acidity": 50}',
    image_upload_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fridge_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    name TEXT,
    quantity TEXT,
    unit TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    title TEXT,
    description TEXT,
    ingredients TEXT,
    instructions TEXT,
    cuisine TEXT,
    difficulty TEXT,
    time TEXT,
    nutrition TEXT,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cravings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    mood TEXT,
    weather TEXT,
    predicted_dish TEXT,
    confidence INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    role TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS meal_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    recipe_id INTEGER,
    date TEXT,
    meal_type TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS grocery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    name TEXT,
    quantity TEXT,
    unit TEXT,
    is_checked INTEGER DEFAULT 0,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'free',
    plan TEXT DEFAULT 'none',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy for express-rate-limit to work correctly behind Cloud Run
  app.set('trust proxy', 1);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for development to allow Vite HMR and external assets
    crossOriginEmbedderPolicy: false,
  }));

  // Rate limiting to prevent DoS
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use X-Forwarded-For if available, otherwise fallback to req.ip
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded) {
        return (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]).trim();
      }
      return req.ip || 'unknown';
    }
  });
  app.use("/api/", limiter);

  app.use(express.json());
  
  // Helper for async routes
  const asyncHandler = (fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>) => 
    (req: express.Request, res: express.Response, next: express.NextFunction) => 
      Promise.resolve(fn(req, res, next)).catch(next);

  // Handle JSON parsing errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
      console.error('JSON Parsing Error:', err.message);
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    next();
  });

  // --- API Routes ---

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "ChefAI Backend with SQLite is running" });
  });

  // --- Stripe Checkout ---
  app.post("/api/create-checkout-session", asyncHandler(async (req, res) => {
    const { userId, plan } = req.body;
    if (!userId) return res.status(400).json({ error: "User ID is required" });

    if (!stripe) {
      // Mock flow for development if Stripe key is missing
      console.log("Mocking Stripe session for user:", userId);
      const appUrl = getAppUrl(req);
      return res.json({ url: `${appUrl}/api/payment-success?userId=${userId}&plan=${plan}` });
    }

    const appUrl = getAppUrl(req);
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `ChefAI Pro Plan (${plan})`,
                description: "Unlock unlimited image uploads and premium features.",
              },
              unit_amount: plan === 'yearly' ? 9900 : 999, // $99 or $9.99
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${appUrl}/api/payment-success?userId=${userId}&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?canceled=true`,
        metadata: { userId, plan },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe error:", error);
      if (error.type === 'StripeAuthenticationError') {
        res.status(401).json({ error: "Invalid Stripe API Key. Please check your configuration in the settings menu." });
      } else if (error.type === 'StripeInvalidRequestError') {
        res.status(400).json({ error: `Stripe request error: ${error.message}` });
      } else if (error.type === 'StripeRateLimitError') {
        res.status(429).json({ error: "Stripe rate limit exceeded. Please try again later." });
      } else if (error.type === 'StripeConnectionError') {
        res.status(503).json({ error: "Unable to connect to Stripe. Please check your internet connection." });
      } else {
        res.status(500).json({ error: error.message || "Failed to create checkout session" });
      }
    }
  }));

  app.get("/api/payment-success", asyncHandler(async (req, res) => {
    const { userId, plan, session_id } = req.query;
    if (!userId) return res.status(400).send("User ID is required");

    // If Stripe is available and we have a session_id, verify it
    if (stripe && session_id && typeof session_id === 'string') {
      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status !== 'paid') {
          return res.status(400).send("Payment not completed");
        }
      } catch (error: any) {
        console.error("Stripe session verification failed:", error);
        return res.status(400).send("Invalid payment session");
      }
    }

    // Update subscription in DB
    db.prepare("INSERT OR REPLACE INTO subscriptions (user_id, status, plan, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run(userId, 'pro', plan);
    
    // Redirect back to app with success flag
    const appUrl = getAppUrl(req);
    res.redirect(`${appUrl}/?success=true`);
  }));

  // User Profile
  app.get("/api/users/:userId", asyncHandler(async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId) as any;
    if (user) {
      user.taste_dna = JSON.parse(user.taste_dna);
      res.json(user);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  }));

  app.post("/api/users", asyncHandler(async (req, res) => {
    const { id, email, display_name, photo_url } = req.body;
    const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    if (existing) {
      existing.taste_dna = JSON.parse(existing.taste_dna);
      return res.json(existing);
    }
    db.prepare("INSERT INTO users (id, email, display_name, photo_url) VALUES (?, ?, ?, ?)").run(id, email, display_name, photo_url);
    const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    newUser.taste_dna = JSON.parse(newUser.taste_dna);
    res.json(newUser);
  }));

  app.patch("/api/users/:userId", asyncHandler(async (req, res) => {
    const { preferred_cuisine, taste_dna } = req.body;
    if (taste_dna && preferred_cuisine) {
      db.prepare("UPDATE users SET preferred_cuisine = ?, taste_dna = ? WHERE id = ?").run(preferred_cuisine, JSON.stringify(taste_dna), req.params.userId);
    } else if (taste_dna) {
      db.prepare("UPDATE users SET taste_dna = ? WHERE id = ?").run(JSON.stringify(taste_dna), req.params.userId);
    } else if (preferred_cuisine) {
      db.prepare("UPDATE users SET preferred_cuisine = ? WHERE id = ?").run(preferred_cuisine, req.params.userId);
    }
    res.json({ success: true });
  }));

  // Fridge Items
  app.get("/api/users/:userId/fridge", asyncHandler(async (req, res) => {
    const items = db.prepare("SELECT * FROM fridge_items WHERE user_id = ? ORDER BY added_at DESC").all(req.params.userId);
    res.json(items);
  }));

  app.post("/api/users/:userId/fridge", asyncHandler(async (req, res) => {
    const { name, quantity, unit } = req.body;
    const result = db.prepare("INSERT INTO fridge_items (user_id, name, quantity, unit) VALUES (?, ?, ?, ?)").run(req.params.userId, name, quantity, unit);
    res.json({ id: result.lastInsertRowid });
  }));

  app.delete("/api/fridge/:id", asyncHandler(async (req, res) => {
    db.prepare("DELETE FROM fridge_items WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  }));

  // Recipes
  app.get("/api/users/:userId/recipes", asyncHandler(async (req, res) => {
    const items = db.prepare("SELECT * FROM recipes WHERE user_id = ? ORDER BY generated_at DESC").all(req.params.userId) as any[];
    items.forEach(item => {
      item.ingredients = JSON.parse(item.ingredients);
      item.instructions = JSON.parse(item.instructions);
      item.nutrition = JSON.parse(item.nutrition);
    });
    res.json(items);
  }));

  app.post("/api/users/:userId/recipes", asyncHandler(async (req, res) => {
    const { title, description, ingredients, instructions, cuisine, difficulty, time, nutrition } = req.body;
    const result = db.prepare(`
      INSERT INTO recipes (user_id, title, description, ingredients, instructions, cuisine, difficulty, time, nutrition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.userId,
      title,
      description,
      JSON.stringify(ingredients),
      JSON.stringify(instructions),
      cuisine,
      difficulty,
      time,
      JSON.stringify(nutrition)
    );
    res.json({ id: result.lastInsertRowid });
  }));

  app.delete("/api/recipes/:id", asyncHandler(async (req, res) => {
    db.prepare("DELETE FROM recipes WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  }));

  // Cravings
  app.get("/api/users/:userId/cravings", asyncHandler(async (req, res) => {
    const items = db.prepare("SELECT * FROM cravings WHERE user_id = ? ORDER BY timestamp DESC LIMIT 5").all(req.params.userId);
    res.json(items);
  }));

  app.post("/api/users/:userId/cravings", asyncHandler(async (req, res) => {
    const { mood, weather, predicted_dish, confidence } = req.body;
    const result = db.prepare("INSERT INTO cravings (user_id, mood, weather, predicted_dish, confidence) VALUES (?, ?, ?, ?, ?)").run(req.params.userId, mood, weather, predicted_dish, confidence);
    res.json({ id: result.lastInsertRowid });
  }));

  // Chat Messages
  app.get("/api/users/:userId/chat", asyncHandler(async (req, res) => {
    const items = db.prepare("SELECT * FROM chat_messages WHERE user_id = ? ORDER BY timestamp ASC LIMIT 50").all(req.params.userId);
    res.json(items);
  }));

  app.post("/api/users/:userId/chat", asyncHandler(async (req, res) => {
    const { role, content } = req.body;
    const result = db.prepare("INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)").run(req.params.userId, role, content);
    res.json({ id: result.lastInsertRowid });
  }));

  // Meal Plans
  app.get("/api/users/:userId/meal-plan", asyncHandler(async (req, res) => {
    const items = db.prepare(`
      SELECT mp.*, r.title as recipe_title 
      FROM meal_plans mp
      LEFT JOIN recipes r ON mp.recipe_id = r.id
      WHERE mp.user_id = ? 
      ORDER BY mp.date ASC
    `).all(req.params.userId);
    res.json(items);
  }));

  app.post("/api/users/:userId/meal-plan", asyncHandler(async (req, res) => {
    const { recipe_id, date, meal_type } = req.body;
    const result = db.prepare("INSERT INTO meal_plans (user_id, recipe_id, date, meal_type) VALUES (?, ?, ?, ?)").run(req.params.userId, recipe_id, date, meal_type);
    res.json({ id: result.lastInsertRowid });
  }));

  app.delete("/api/meal-plan/:id", asyncHandler(async (req, res) => {
    db.prepare("DELETE FROM meal_plans WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  }));

  // Grocery List
  app.get("/api/users/:userId/grocery", asyncHandler(async (req, res) => {
    const items = db.prepare("SELECT * FROM grocery_items WHERE user_id = ? ORDER BY added_at DESC").all(req.params.userId);
    res.json(items);
  }));

  app.post("/api/users/:userId/grocery", asyncHandler(async (req, res) => {
    const { name, quantity, unit } = req.body;
    const result = db.prepare("INSERT INTO grocery_items (user_id, name, quantity, unit) VALUES (?, ?, ?, ?)").run(req.params.userId, name, quantity, unit);
    res.json({ id: result.lastInsertRowid });
  }));

  app.patch("/api/grocery/:id", asyncHandler(async (req, res) => {
    const { is_checked } = req.body;
    db.prepare("UPDATE grocery_items SET is_checked = ? WHERE id = ?").run(is_checked ? 1 : 0, req.params.id);
    res.json({ success: true });
  }));

  app.delete("/api/grocery/:id", asyncHandler(async (req, res) => {
    db.prepare("DELETE FROM grocery_items WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  }));

  // Subscriptions
  app.get("/api/users/:userId/subscription", asyncHandler(async (req, res) => {
    const sub = db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(req.params.userId);
    if (sub) {
      res.json(sub);
    } else {
      res.json({ status: 'free', plan: 'none' });
    }
  }));

  app.post("/api/users/:userId/subscription", asyncHandler(async (req, res) => {
    const { status, plan } = req.body;
    db.prepare("INSERT OR REPLACE INTO subscriptions (user_id, status, plan, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run(req.params.userId, status, plan);
    res.json({ success: true });
  }));

  app.patch("/api/users/:userId/increment-image-count", asyncHandler(async (req, res) => {
    db.prepare("UPDATE users SET image_upload_count = image_upload_count + 1 WHERE id = ?").run(req.params.userId);
    res.json({ success: true });
  }));

  // Global API Error Handler
  app.use("/api/", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("API Error:", err);
    const status = err.status || 500;
    const message = err.message || "Internal server error";
    res.status(status).json({ error: message });
  });

  // --- Vite Middleware ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
