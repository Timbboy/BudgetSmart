const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database
const db = new sqlite3.Database('database.db', (err) => {
  if (err) console.error(err);
  console.log('Database connected');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS sellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    website TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT,
    FOREIGN KEY(seller_id) REFERENCES sellers(id)
  )`);
});

// Multer
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Background scraper (fire and forget)
async function scrapeWebsite(sellerId, website, sellerName) {
  try {
    console.log(`Scraping started: ${sellerName} → ${website}`);
    const { data } = await axios.get(website, { timeout: 25000 });
    const $ = cheerio.load(data);
    let count = 0;

    $('a[href*="/product"], a[href*="/item"], .product, .item, .card, [data-product]').each((i, el) => {
      if (count >= 150) return;
      const link = $(el).attr('href') || '';
      const fullLink = link.startsWith('http') ? link : new URL(link || '/', website).href;

      const title = $(el).find('.title, .name, h1, h2, h3, h4, [data-title], .product-title')
        .first().text().trim() || $(el).text().trim().substring(0, 150);

      const priceText = $(el).find('.price, .amount, [data-price], .product-price, .current-price')
        .first().text().replace(/[^0-9.]/g, '');
      const price = parseFloat(priceText);

      const img = $(el).find('img').first().attr('src') || $(el).find('img').attr('data-src') || $(el).find('img').attr('data-lazy-src');
      const image = img ? (img.startsWith('http') ? img : new URL(img, website).href) : '/uploads/default.jpg';

      if (title && price > 0) {
        db.run(`INSERT OR IGNORE INTO items (seller_id, name, price, image) VALUES (?, ?, ?, ?)`,
          [sellerId, title, price, image]);
        count++;
      }
    });
    console.log(`Added ${count} products from ${sellerName}`);
  } catch (err) {
    console.log(`Scraping failed for ${website}: ${err.message}`);
  }
}

// ======================= API =======================
app.post('/api/seller', upload.single('image'), async (req, res) => {
  const { sellerName, website, itemName, itemPrice, type } = req.body;
  let sellerId;

  try {
    // Find or create seller
    const existing = await new Promise(r => db.get(
      `SELECT id FROM sellers WHERE name = ? OR website LIKE ?`, 
      [sellerName, `%${website || ''}%`], 
      (err, row) => r(row)
    ));

    if (existing) {
      sellerId = existing.id;
    } else {
      sellerId = await new Promise((resolve, reject) => {
        db.run(`INSERT INTO sellers (name, website) VALUES (?, ?)`,
          [sellerName, website || ''],
          function (err) { err ? reject(err) : resolve(this.lastID); }
        );
      });
    }

    // Manual upload
    if (type === 'manual' && req.file) {
      const imagePath = `/uploads/${req.file.filename}`;
      db.run(`INSERT INTO items (seller_id, name, price, image) VALUES (?, ?, ?, ?)`,
        [sellerId, itemName, parseFloat(itemPrice), imagePath]);
      return res.json({ success: true, message: 'Item added instantly!' });
    }

    // Website connection → background scraping
    if (type === 'website' && website) {
      scrapeWebsite(sellerId, website.trim(), sellerName);
      return res.json({ 
        success: true, 
        message: `Store connected! Adding products now (1–3 minutes)` 
      });
    }

    res.status(400).json({ error: 'Invalid data' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fuzzy search + works with partial names
app.post('/api/search', (req, res) => {
  const { items: searchItems, budget } = req.body;
  const budgetNum = parseFloat(budget);

  if (!Array.isArray(searchItems) || searchItems.length === 0 || isNaN(budgetNum)) {
    return res.json({ cheaper: [], exact: [], above: [] });
  }

  const whereParts = searchItems.map(() => `i.name LIKE ?`).join(' OR ');
  const params = searchItems.map(item => `%${item.trim()}%`);

  const sql = `
    SELECT i.name as item_name, i.price, i.image, s.name as seller_name, s.website
    FROM items i JOIN sellers s ON i.seller_id = s.id
    WHERE ${whereParts}
  `;

  db.all(sql, params, (err, rows) => {
    if (err || rows.length === 0) return res.json({ cheaper: [], exact: [], above: [] });

    // Simple single-item results (you can expand later)
    const results = rows.map(row => ({
      item: row.item_name,
      price: row.price,
      image: row.image || '/uploads/default.jpg',
      seller: row.seller_name,
      website: row.website || '#'
    }));

    const cheaper = results.filter(r => r.price < budgetNum);
    const exact = results.filter(r => Math.abs(r.price - budgetNum) < 5000);
    const above = results.filter(r => r.price <= budgetNum * 1.2 && r.price > budgetNum);

    res.json({
      cheaper: cheaper.slice(0, 5),
      exact: exact.slice(0, 5),
      above: above.slice(0, 5)
    });
  });
});

// Debug route — see what’s in DB
app.get('/api/debug', (req, res) => {
  const q = req.query.q || '';
  db.all(`SELECT i.name, i.price, s.name as seller FROM items i JOIN sellers s ON i.seller_id = s.id 
          WHERE i.name LIKE ? OR s.name LIKE ? LIMIT 30`, [`%${q}%`, `%${q}%`], (err, rows) => {
    res.json(rows || []);
  });
});

app.listen(PORT, () => console.log(`BudgetSmart LIVE → https://budgetsmart-ng.onrender.com`));
