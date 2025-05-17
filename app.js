const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const { ignoreDirectories, globalProjectVariables } = require("./config");

const app = express();

// Middleware setup
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.render("index", { message: null, warnings: [], warningCount: 0 });
});

app.post("/check", async (req, res) => {
  const { directoryPath, pageName, checkType, checkOption } = req.body;
  const warnings = [];

  const directoryExists = await fs.pathExists(directoryPath);
  if (!directoryExists) {
    return res.render("index", {
      message: "Invalid directory path. Please try again.",
      warnings: [],
      warningCount: 0,
    });
  }

  try {
    const allFiles = await getReactFiles(directoryPath);

    if (checkType === "project") {
      for (let file of allFiles) {
        await checkFile(file, directoryPath, warnings, checkOption);
      }
    } else {
      const pageFiles = pageName.split(",").map((name) => name.trim());

      for (let page of pageFiles) {
        const matchedFiles = allFiles.filter((file) => file.endsWith(page));

        if (matchedFiles.length === 0) {
          warnings.push({
            filePath: directoryPath,
            fileName: page,
            type: "⚠️ File not found",
            message: `The file '${page}' was not found in any subdirectory.`,
          });
          continue;
        }

        for (let filePath of matchedFiles) {
          await checkFile(filePath, directoryPath, warnings, checkOption);
        }
      }
    }

    res.render("index", {
      message: null,
      warnings,
      warningCount: warnings.length,
    });
  } catch (error) {
    console.error("Error during check:", error.message);
    res.render("index", {
      message: "An error occurred. Please try again.",
      warnings: [],
      warningCount: 0,
    });
  }
});

// Helper: Recursively fetch valid files
async function getReactFiles(dir) {
  let files = [];
  const items = await fs.readdir(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = await fs.stat(fullPath);

    // Skip ignored folders
    if (stat.isDirectory()) {
      if (!ignoreDirectories.includes(item)) {
        files.push(...(await getReactFiles(fullPath)));
      }
    } else if (/\.(js|jsx|html|php)$/.test(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

// File check based on selected check option
async function checkFile(filePath, basePath, warnings, checkOption) {
  const exists = await fs.pathExists(filePath);
  const fileName = path.basename(filePath);

  if (!exists) {
    warnings.push({
      filePath: basePath,
      fileName,
      type: "⚠️ File not found",
      message: `The file '${fileName}' does not exist.`,
    });
    return;
  }

  const content = await fs.readFile(filePath, "utf-8");
  const $ = cheerio.load(content);

  switch (checkOption) {
    case "showAll":
      checkForMissingAltAttributes($, warnings, filePath, fileName, content);
      //await checkForBrokenLinks($, warnings, filePath, fileName, content);
      //checkForMissingFooter($, warnings, filePath, fileName, content);
      checkForGlobalProjectVariablesMissing($, warnings, filePath, fileName, content);

      break;
    case "missingAltTags":
      checkForMissingAltAttributes($, warnings, filePath, fileName, content);
      break;
    case "brokenLinks":
      await checkForBrokenLinks($, warnings, filePath, fileName, content);
      break;
    case "missingFooter":
      checkForMissingFooter($, warnings, filePath, fileName, content);
      break;
    case "GlobalProjectVariablesMissing":
      checkForGlobalProjectVariablesMissing($, warnings, filePath, fileName, content);
      break;
  }
}

// ===== Check Functions =====

function checkForMissingAltAttributes( $, warnings, filePath, fileName, content) {
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    const src = $(el).attr("src") || "[no src]";
    if (!alt || alt.trim() === "") {
      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Missing alt",
        message: `Image with src '${src}' is missing alt text.`,
        lineNumber: findLineNumber(src, content),
      });
    }
  });
}

async function checkForBrokenLinks($, warnings, filePath, fileName, content) {
  const links = $("a")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter((href) => href && href.startsWith("http"));

  const promises = links.map((link) =>
    axios.get(link).catch(() => {
      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Broken link",
        message: `Broken link: ${link}`,
        lineNumber: findLineNumber(link, content),
      });
    })
  );

  await Promise.all(promises);
}

function checkForMissingFooter($, warnings, filePath, fileName, content) {
  if ($("footer").length === 0) {
    warnings.push({
      filePath,
      fileName,
      type: "⚠️ Missing footer",
      message: `Missing <footer> tag.`,
      lineNumber: findLineNumber("<footer>", content),
    });
  }
}

function checkForGlobalProjectVariablesMissing( $, warnings, filePath, fileName, content) {
  const globals = globalProjectVariables;
  globals.forEach((varName) => {
    if (content.includes(varName)) {
      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Global variable usage",
        message: `Global variable '${varName}' found. Consider modular approach.`,
        lineNumber: findLineNumber(varName, content),
      });
    }
  });
}

// Utility: Line number locator
function findLineNumber(searchString, content) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchString)) return i + 1;
  }
  return -1;
}

// Start server
app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
