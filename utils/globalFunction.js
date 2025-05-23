const fs = require("fs-extra");
const path = require("path");
const {
  ignoreFileFiles,
  globalProjectVariables,
  ignoreDirectories,
} = require("../config");

// Check for missing alt attributes
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

// Check for invalid mailto links
function checkForInvalidMailtoLinks($, warnings, filePath, fileName, content) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const lines = content.split("\n");

  // To track where we last found href to handle duplicates properly
  let lastIndex = 0;

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const target = $(el).attr("target");

    if (!href.startsWith("mailto:")) return;

    const email = href.replace("mailto:", "").trim();
    const searchSnippet = `href="${href}"`;
    // Find index of this link starting from lastIndex to support duplicates
    const index = content.indexOf(searchSnippet, lastIndex);

    if (index === -1) {
      // fallback if not found, just skip line number
      lastIndex = 0;
      return;
    }

    lastIndex = index + searchSnippet.length;

    // Calculate line number by counting \n before index
    let lineNumber = content.substring(0, index).split("\n").length;

    // Check if line contains #evIgnore
    const shouldIgnore = lines[lineNumber - 1]?.includes("#evIgnore");
    if (shouldIgnore) return;

    if (!emailRegex.test(email)) {
      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Invalid mailto",
        message: `Invalid mailto link '${href}'.`,
        lineNumber,
      });
    }

    if (target !== "_blank") {
      warnings.push({
        filePath,
        fileName,
        type: '⚠️ Missing target="_blank"',
        message: `Mailto link '${href}' should use target="_blank".`,
        lineNumber,
      });
    }
  });
}

// Check for console logs
async function removeConsoleLogs(_, warnings, filePath, fileName, content) {
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (
      line.includes("console.log") ||
      line.includes("console.error") ||
      line.includes("console.warn")
    ) {
      if (line.includes("#evIgnore")) return;

      warnings.push({
        filePath,
        fileName,
        type: "⚠️ Console statement",
        message: `Avoid using console statement at line ${index + 1}`,
        lineNumber: index + 1,
      });
    }
  });
}

// Check for empty files
async function checkForEmptyFiles(_, warnings, filePath, fileName, content) {
  if (ignoreFileFiles.includes(fileName)) return;

  if (content.trim().length === 0) {
    warnings.push({
      filePath,
      fileName,
      type: "⚠️ Empty file",
      message: `File '${fileName}' is empty.`,
      lineNumber: "N/A",
    });
  }
}

// Check for broken links
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

// Check for HTML comments

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

// Check for missing footer
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

// Check for missing footer
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

// Check for missing footer
function findLineNumber(searchString, content) {
  const index = content.indexOf(searchString);
  if (index === -1) return -1;

  const linesUntilMatch = content.slice(0, index).split("\n");
  return linesUntilMatch.length;
}

//start
// Get all folders recursively
async function getAllFolders(dir, folders = []) {
  const items = await fs.readdir(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory() && !ignoreDirectories.includes(item)) {
      folders.push(fullPath);
      await getAllFolders(fullPath, folders);
    }
  }

  return folders;
}
// Push warning if index.php was created
async function checkFolderForMissingIndexPhp(folderPath, warnings) {
  const indexPath = path.join(folderPath, "index.php");
  const exists = await fs.pathExists(indexPath);

  if (!exists) {
    await fs.writeFile(indexPath, "<?php\n// Auto-generated index.php\n?>");

    // Add this debug log line here:
    // console.log("Reporting missing index.php:", folderPath);

    warnings.push({
      filePath: folderPath,
      fileName: "index.php",
      type: "⚠️ Missing index.php",
      message: `index.php was missing and has been created.`,
      lineNumber: "N/A",
    });
  }
}
//end

module.exports = {
  checkForMissingAltAttributes,
  checkForInvalidMailtoLinks,
  removeConsoleLogs,
  checkForEmptyFiles,
  checkForBrokenLinks,
  checkForHtmlComments,
  checkForGlobalProjectVariablesMissing,
  checkForMissingFooter,
  checkFolderForMissingIndexPhp,
  getAllFolders,
};
