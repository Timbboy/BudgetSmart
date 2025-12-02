import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Save seller submission (file or URL)
router.post("/", upload.single("file"), (req, res) => {
  const { website } = req.body;
  const file = req.file;

  let sellerData = { website: website || null, file: null };

  if (file) {
    sellerData.file = file.filename;
  }

  // Save to sources.json
  const sourcesFile = path.join(process.cwd(), "sources.json");
  let sources = [];
  if (fs.existsSync(sourcesFile)) {
    sources = JSON.parse(fs.readFileSync(sourcesFile, "utf-8"));
  }

  sources.push(sellerData);
  fs.writeFileSync(sourcesFile, JSON.stringify(sources, null, 2));

  res.json({ message: "Seller added successfully!" });
});

export default router;
