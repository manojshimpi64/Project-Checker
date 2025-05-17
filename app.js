const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const app = express();

// Set EJS as the templating engine
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Route to display the form
app.get("/", (req, res) => {
  res.render("index", { message: null, warnings: [], warningCount: 0 });
});

// Route to handle form submission
app.post("/check", async (req, res) => {
  const { directoryPath, pageName, checkType } = req.body;
  const warnings = [];

  // Validate directory path
  const directoryExists = await fs.pathExists(directoryPath);
  if (!directoryExists) {
    return res.render("index", {
      message: "Invalid directory path. Please try again.",
      warnings: [],
      warningCount: 0,
    });
  }

  try {
    if (checkType === "project") {
      // Full project check: Get all .js or .jsx files in the directory
      const reactFiles = await getReactFiles(directoryPath);
      for (let file of reactFiles) {
        await checkFile(file, directoryPath, warnings);
      }
    } else {
      // Single file check
      const pageFiles = pageName.split(",").map((name) => name.trim());
      for (let page of pageFiles) {
        const pageFile = path.join(directoryPath, page);
        await checkFile(pageFile, directoryPath, warnings);
      }
    }

    // Calculate the total count of warnings
    const warningCount = warnings.length;

    res.render("index", { message: null, warnings, warningCount });
  } catch (error) {
    console.error("Error during website check:", error.message);
    res.render("index", {
      message: "An error occurred. Please try again.",
      warnings: [],
      warningCount: 0,
    });
  }
});

// Helper function to get all React files (.jsx, .js)
async function getReactFiles(directoryPath) {
  const files = [];
  const items = await fs.readdir(directoryPath);

  for (const item of items) {
    const itemPath = path.join(directoryPath, item);
    const stat = await fs.stat(itemPath);
    if (stat.isDirectory()) {
      files.push(...(await getReactFiles(itemPath))); // Recursively get files in subdirectories
    } else if (
      itemPath.endsWith(".js") ||
      itemPath.endsWith(".jsx") ||
      itemPath.endsWith(".php") ||
      itemPath.endsWith(".html")
    ) {
      files.push(itemPath);
    }
  }
  return files;
}

// Function to check a single file for issues
async function checkFile(filePath, directoryPath, warnings) {
  const fileExists = await fs.pathExists(filePath);
  if (!fileExists) {
    warnings.push({
      filePath: directoryPath,
      fileName: path.basename(filePath),
      type: "⚠️ File not found",
      message: `The page '${path.basename(
        filePath
      )}' does not exist in the specified directory.`,
    });
    return;
  }

  const content = await fs.readFile(filePath, "utf-8");
  const $ = cheerio.load(content);

  // Check for missing tags
  //checkForMissingTags($, warnings, filePath, path.basename(filePath), content);

  // Check for missing alt attributes
  checkForMissingAltAttributes(
    $,
    warnings,
    filePath,
    path.basename(filePath),
    content
  );

  // Check for broken links
  await checkForBrokenLinks(
    $,
    warnings,
    filePath,
    path.basename(filePath),
    content
  );
}

// Check for missing essential tags with line numbers
function checkForMissingTags($, warnings, filePath, fileName, content) {
  const essentialTags = ["header", "footer", "main", "nav"];
  essentialTags.forEach((tag) => {
    if ($(tag).length === 0) {
      const lineNumber = findLineNumber(tag, content);
      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Missing tag",
        message: `Missing <${tag}> tag in ${fileName}.`,
        lineNumber, // Added line number
      });
    }
  });
}

// Check for missing alt attributes with line numbers
function checkForMissingAltAttributes(
  $,
  warnings,
  filePath,
  fileName,
  content
) {
  $("img").each((i, el) => {
    const alt = $(el).attr("alt");
    const src = $(el).attr("src") || "[no src]";
    if (!alt || alt.trim() === "") {
      const lineNumber = findLineNumber(src, content); // Get line number of missing alt
      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Missing alt",
        message: `Image with src '${src}' in ${fileName} is missing alt text.`,
        lineNumber, // Added line number
      });
    }
  });
}

// Check for broken links with line numbers
async function checkForBrokenLinks($, warnings, filePath, fileName, content) {
  const links = [];
  $("a").each((i, el) => {
    const href = $(el).attr("href");
    if (href && href.startsWith("http")) {
      links.push(href);
    }
  });

  const linkPromises = links.map((link) =>
    axios
      .get(link)
      .then(() => {})
      .catch(() => {
        const lineNumber = findLineNumber(link, content); // Get line number of broken link
        warnings.push({
          filePath,
          fileName,
          type: "⚠️ Broken link",
          message: `Broken link found: ${link} in ${fileName}`,
          lineNumber, // Added line number
        });
      })
  );
  await Promise.all(linkPromises);
}

// Helper function to find the line number of an element in the file content
function findLineNumber(searchString, content) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchString)) {
      return i + 1; // Line numbers start from 1
    }
  }
  return -1; // Return -1 if not found
}

// Start the server
app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
