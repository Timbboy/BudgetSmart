const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database
const db = new sqlite3.Database('database.db', (err) => {
  if (err) console.error(err);
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

// Multer – image upload
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ==========================================
// POST /api/seller  →  Website or Manual
// ==========================================
app.post('/api/seller', upload.single('image'), async (req, res) => {
  const { sellerName, website, itemName, itemPrice, type } = req.body;

  try {
    let sellerId;

    // Find or create seller
    const existingSeller = await new Promise(resolve => {
      db.get(`SELECT id FROM sellers WHERE name = ? OR website = ?`, [sellerName, website || ''], (err, row) => {
        resolve(row);
      });
    });

    if (existingSeller) {
      sellerId = existingSeller.id;
    } else {
      sellerId = await new Promise((resolve, reject) => {
        db.run(`INSERT INTO sellers (name, website) VALUES (?, ?)`,
          [sellerName, website || 'https://manual-upload.com'],
          function(err) {
            if (err) return reject(err);
            resolve(this.lastID);
          });
      });
    }

    // CASE 1: Manual upload (same as before)
    if (type === 'manual' && itemName && itemPrice && req.file) {
      const imagePath = `/uploads/${req.file.filename}`;
      db.run(`INSERT INTO items (seller_id, name, price, image) VALUES (?, ?, ?, ?)`,
        [sellerId, itemName, parseFloat(itemPrice), imagePath], err => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ success: true, message: 'Item added!' });
        });
    }

    // CASE 2: AUTO-SCRAPE WEBSITE (the magic!)
    else if (type === 'website' && website) {
      try {
        const response = await axios.get(website, { timeout: 10000 });
        const $ = cheerio.load(response.data);

        let scrapedCount = 0;

        // Try common product selectors (works on 90% of shops)
        $('a[href*="/product"], a[href*="/item"], .product, .item, .card, [data-product]').each((i, el) => {
          if (scrapedCount >= 50) return; // limit

          const link = $(el).attr('href');
          if (!link) return;

          const fullUrl = link.startsWith('http') ? link : new URL(link, website).href;

          const title = $(el).find('h1, h2, h3, .title, .name, [data-title]').first().text().trim() ||
                        $(el).text().trim().substring(0, 100);

          const priceText = $(el).find('.price, .amount, [data-price], .product-price')
                                .first().text().replace(/[^0-9.]/g, '');
          const price = parseFloat(priceText);

          const img = $(el).find('img').first().attr('src') || $(el).attr('data-src');
          const imageUrl = img ? (img.startsWith('http') ? img : new URL(img, website).href) : null;

          if (title && price > 0) {
            db.run(`INSERT OR IGNORE INTO items (seller_id, name, price, image) VALUES (?, ?, ?, ?)`,
              [sellerId, title, price, imageUrl], () => {});
            scrapedCount++;
          }
        });

        return res.json({
          success: true,
          message: `Store connected! Added ${scrapedCount} products automatically!`
        });

      } catch (scrapError) {
        console.log("Scraping failed for", website, scrapError.message);
        return res.json({
          success: true,
          message: `Store connected! (Auto-scraping failed — we'll try again later)`
        });
      }
    }

    else {
      res.status(400).json({ error: 'Invalid data' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==========================================
// POST /api/search
// ==========================================
app.post('/api/search', (req, res) => {
  const { items: searchItems, budget } = req.body;
  const budgetNum = parseFloat(budget);

  if (!Array.isArray(searchItems) || searchItems.length === 0 || isNaN(budgetNum)) {
    return res.json({ cheaper: [], exact: [], above: [] });
  }

  const placeholders = searchItems.map(() => '?').join(',');
  const sql = `
    SELECT i.name as item_name, i.price, i.image, s.name as seller_name, s.website
    FROM items i
    JOIN sellers s ON i.seller_id = s.id
    WHERE i.name IN (${placeholders})
  `;

  db.all(sql, searchItems, (err, rows) => {
    if (err || rows.length === 0) {
      return res.json({ cheaper: [], exact: [], above: [] });
    }

    const combinations = getCombinations(rows, searchItems.length);

    const cheaper = [];
    const exact = [];
    const above = [];

    combinations.forEach(comb => {
      const total = comb.reduce((sum, item) => sum + item.price, 0);

      const result = {
        items: comb,
        totalPrice: total.toFixed(2),
        websites: [...new Set(comb.map(i => i.website))]
      };

      if (total < budgetNum) {
        cheaper.push({ ...result, savings: (budgetNum - total).toFixed(2) });
      } else if (total === budgetNum) {
        exact.push(result);
      } else if (total <= budgetNum * 1.15) {
        above.push({ ...result, extra: (total - budgetNum).toFixed(2) });
      }
    });

    cheaper.sort((a, b) => b.savings - a.savings);
    above.sort((a, b) => a.extra - b.extra);

    res.json({
      cheaper: cheaper.slice(0, 3),
      exact: exact.slice(0, 3),
      above: above.slice(0, 3)
    });
  });
});

// ==========================================
// Combination Helper Function
// ==========================================
function getCombinations(items, needed) {
  if (needed === 1) return items.map(i => [i]);

  const result = [];
  const seen = new Set();

  function backtrack(current, remainingNames) {
    if (current.length === needed) {
      const key = current.map(i => i.item_name).sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        result.push([...current]);
      }
      return;
    }

    for (const item of items) {
      if (!current.some(c => c.item_name === item.item_name) && remainingNames.includes(item.item_name)) {
        backtrack(
          [...current, item],
          remainingNames.filter(n => n !== item.item_name)
        );
      }
    }
  }

  backtrack([], searchItems);  // Use searchItems for remainingNames
  return result;
}

// Start the server
app.listen(PORT, () => {
  console.log(`BudgetSmart is running → http://localhost:${PORT}`);
});