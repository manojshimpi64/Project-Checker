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
  res.render("index", {
    message: null,
    warnings: [],
    warningCount: 0,
    directoryPath: "",
    pageName: "",
    checkType: "",
    checkOption: "",
  });
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
      directoryPath,
      pageName,
      checkType,
      checkOption,
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

    const hasWarnings = warnings.length > 0;
    res.render("index", {
      message: hasWarnings ? null : "✅ No issues found!",
      warnings,
      warningCount: warnings.length,
      directoryPath,
      pageName,
      checkType,
      checkOption,
    });
  } catch (error) {
    console.error("Error during check:", error.message);
    res.render("index", {
      message: "An error occurred. Please try again.",
      warnings: [],
      warningCount: 0,
      directoryPath,
      pageName,
      checkType,
      checkOption,
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
      checkForHtmlComments($, warnings, filePath, fileName, content);

      checkForGlobalProjectVariablesMissing(
        $,
        warnings,
        filePath,
        fileName,
        content
      );
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
    case "htmlComments":
      checkForHtmlComments($, warnings, filePath, fileName, content);
      break;
    case "GlobalProjectVariablesMissing":
      checkForGlobalProjectVariablesMissing(
        $,
        warnings,
        filePath,
        fileName,
        content
      );
      break;
  }
}

// ===== Check Functions =====
function checkForMissingAltAttributes(
  $,
  warnings,
  filePath,
  fileName,
  content
) {
  const lines = content.split("\n");
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    const src = $(el).attr("src") || "[no src]";

    let lineNumber = -1;
    let shouldIgnore = false;

    for (let i = 0; i < lines.length; i++) {
      if (src !== "[no src]" && lines[i].includes(src)) {
        lineNumber = i + 1;

        if (lines[i].includes("#evIgnore")) {
          shouldIgnore = true;
        }
        break;
      }
    }

    if (shouldIgnore) return; // ⬅️ Only skips this image

    if (!alt || alt.trim() === "") {
      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Missing alt",
        message: `Image with src '${src}' is missing alt text.`,
        lineNumber: lineNumber !== -1 ? lineNumber : null,
      });
    }
  });
}

// by sunil
// function checkForMissingAltAttributes(
//   $,
//   warnings,
//   filePath,
//   fileName,
//   content
// ) {
//   const lines = content.split("\n");

//   $("img").each((_, el) => {
//     const alt = $(el).attr("alt");
//     const src = $(el).attr("src") || "[no src]";
//     const html = $.html(el);

//     // Find which line this <img> tag appears on
//     for (let i = 0; i < lines.length; i++) {
//       if (lines[i].includes(html)) {
//         const lineContent = lines[i];

//         // Skip if line contains "#evIgnore"
//         if (lineContent.includes("#evIgnore")) {
//           return;
//         }

//         if (!alt || alt.trim() === "") {
//           warnings.push({
//             filePath,
//             fileName,
//             type: "⚠️ Missing alt",
//             message: `Image with src '${src}' is missing alt text.`,
//             lineNumber: i + 1,
//           });
//         }

//         break; // Found the line, no need to continue
//       }
//     }
//   });
// }

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

function checkForHtmlComments($, warnings, filePath, fileName, content) {
  const commentRegex = /<!--([\s\S]*?)-->/g;
  let match;

  while ((match = commentRegex.exec(content)) !== null) {
    const fullMatch = match[0]; // Full comment string: <!-- ... -->
    const commentText = match[1].trim(); // Inner text
    const lineNumber = findLineNumber(fullMatch, content);

    // Skip empty comments
    if (!commentText) continue;

    // Determine if it's single-line or multi-line
    const isMultiline = fullMatch.includes("\n");
    const type = isMultiline
      ? "📄 Multi-line HTML comment"
      : "💬 Single-line HTML comment";

    warnings.push({
      filePath,
      fileName,
      type,
      message: `Found HTML comment: "${commentText.slice(0, 80)}${
        commentText.length > 80 ? "..." : ""
      }"`,
      lineNumber,
    });
  }
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

// function checkForGlobalProjectVariablesMissing(
//   $,
//   warnings,
//   filePath,
//   fileName,
//   content
// ) {
//   const globals = globalProjectVariables;
//   globals.forEach((varName) => {
//     if (content.includes(varName)) {
//       warnings.push({
//         filePath,
//         fileName,
//         type: "⚠️ Global variable usage",
//         message: `Global variable '${varName}' found. Consider modular approach.`,
//         lineNumber: findLineNumber(varName, content),
//       });
//     }
//   });
// }

function checkForGlobalProjectVariablesMissing(
  _,
  warnings,
  filePath,
  fileName,
  content
) {
  const globals = globalProjectVariables;
  const lines = content.split("\n");

  globals.forEach((varName) => {
    const regex = new RegExp(varName, "g"); // Match all occurrences
    let match;

    while ((match = regex.exec(content)) !== null) {
      const matchIndex = match.index;

      // Find the line number and content
      let charCount = 0;
      let lineNumber = 0;
      for (let i = 0; i < lines.length; i++) {
        charCount += lines[i].length + 1; // +1 for the newline char
        if (charCount > matchIndex) {
          lineNumber = i + 1;
          break;
        }
      }

      const lineContent = lines[lineNumber - 1];

      // Skip if the line contains "#evIgnore"
      if (lineContent.includes("#evIgnore")) continue;

      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Global variable usage",
        message: `Global variable '${varName}' found. Consider modular approach.`,
        lineNumber,
      });
    }
  });
}

/*
function checkForGlobalProjectVariablesMissing(
  _,
  warnings,
  filePath,
  fileName,
  content
) {
  const globals = globalProjectVariables;

  globals.forEach((varName) => {
    const regex = new RegExp(varName, "g"); // Match all occurrences
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lineNumber = findLineNumber(varName, content, match.index);

      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Global variable usage",
        message: `Global variable '${varName}' found. Consider modular approach.`,
        lineNumber,
      });
    }
  });
} */

// Utility: Line number locator
function findLineNumber(searchString, content) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchString)) return i + 1;
  }
  return -1;
}

/*function findLineNumber(searchString, content, fromIndex = 0) {
  const lines = content.slice(0, fromIndex).split("\n");
  return lines.length;
}*/

// Start server
app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
