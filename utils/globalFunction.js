import fs from "fs-extra";
import path from "path";
import * as cheerio from "cheerio";
import config from "../config.js";
import readline from "readline";

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
  if (config.ignoreFileFiles.includes(fileName)) return;

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

function checkDotHtmlLinkInAnchor(
  _,
  warnings,
  filePath,
  fileName,
  content,
  ignoreFiles = config.ignoreGlobalFilesForGlobalVariablesCheck
) {
  // Skip processing if file is in ignore list
  if (ignoreFiles.includes(fileName)) {
    return;
  }
  // Pattern to match any reference to .html pages in the content (links, scripts, etc.)
  const htmlLinkPattern = /["']([^"']+\.html)["']/g; // Matches href="page.html", src="page.html", etc.
  const lines = content.split("\n");

  let match;

  // Loop through all matches of .html links
  while ((match = htmlLinkPattern.exec(content)) !== null) {
    const matchUrl = match[1]; // Extract the matched URL (e.g., "project-details.html")
    const matchIndex = match.index;

    // Find the line number and content where the match occurred
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

    // Skip processing if the line contains "#evIgnore"
    if (lineContent.includes("#evIgnore")) continue;

    // Add a warning for the .html link found
    warnings.push({
      filePath,
      fileName,
      type: "⚠️ .html page link",
      message: `Found reference to '.html' page link: '${matchUrl}'. Please consider using dynamic routing or other strategies for handling links.`,
      lineNumber,
    });
  }
}

function checkForGlobalProjectVariablesMissing(
  _,
  warnings,
  filePath,
  fileName,
  content,
  ignoreFiles = config.ignoreGlobalFilesForGlobalVariablesCheck
) {
  // Skip processing if file is in ignore list
  if (ignoreFiles.includes(fileName)) {
    return;
  }

  const globals = config.globalProjectVariables;
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

// D - Start
// Get all folders recursively
async function getAllFolders(dir, folders = []) {
  const items = await fs.readdir(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory() && !config.ignoreDirectories.includes(item)) {
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

// Check for old project domain names inside file content
function checkForOldProjectDomains(_, warnings, filePath, fileName, content) {
  const lines = content.split("\n");

  config.oldProjectDomainsNames.forEach((domain) => {
    lines.forEach((line, index) => {
      if (line.includes(domain)) {
        warnings.push({
          filePath,
          fileName,
          type: "⚠️ Old Domain Reference",
          message: `Domain "${domain}" found in file.`,
          lineNumber: index + 1,
        });
      }
    });
  });
}
// D - End

// Start missing images check code
function isWarningDuplicate(warnings, warningKey) {
  return warnings.some((w) => w.warningKey === warningKey);
}

async function findMissingImages(directoryPath, warnings) {
  const referencedImages = new Map(); // Map<imgName, Set<"filePath|lineNumber">>
  const existingImages = new Set();

  await scanDirectory(directoryPath, referencedImages, existingImages);

  for (const [img, references] of referencedImages.entries()) {
    if (!existingImages.has(img)) {
      for (const refKey of references) {
        const [filePath, lineNumberStr] = refKey.split("|");
        const lineNumber = parseInt(lineNumberStr, 10);

        const warningKey = `missing|${img}|${filePath}|${lineNumber}`;

        if (!isWarningDuplicate(warnings, warningKey)) {
          warnings.push({
            filePath,
            fileName: path.basename(filePath),
            type: "🖼️ Missing Image File",
            message: `The image '${img}' is referenced in code but does not exist in the directory.`,
            lineNumber,
            warningKey,
          });
        }
      }
    }
  }
}

async function scanDirectory(dirPath, referencedImages, existingImages) {
  const entries = await fs.readdir(dirPath);

  for (const entry of entries) {
    if (config.ignoreDirectories.includes(entry)) continue;

    const fullPath = path.join(dirPath, entry);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      await scanDirectory(fullPath, referencedImages, existingImages);
    } else {
      const ext = path.extname(entry).toLowerCase();

      if (
        [".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".avif"].includes(
          ext
        )
      ) {
        existingImages.add(entry);
      }

      if (
        [".html", ".php", ".js", ".jsx", ".ts", ".tsx", ".css"].includes(ext)
      ) {
        const content = await fs.readFile(fullPath, "utf-8");
        const $ = cheerio.load(content);
        const lines = content.split("\n");

        $("img").each((_, el) => {
          const src = $(el).attr("src");
          if (!src || src.startsWith("http")) return;

          const img = path.basename(src);

          // Find **all** line numbers where this img src appears, not just first occurrence
          const imgLines = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(src)) {
              if (lines[i].includes("#evIgnore")) continue;
              imgLines.push(i + 1);
            }
          }

          if (!referencedImages.has(img)) {
            referencedImages.set(img, new Set());
          }

          const refSet = referencedImages.get(img);

          // Add all found line numbers for this image in this file
          for (const lineNumber of imgLines) {
            const key = `${fullPath}|${lineNumber}`;
            refSet.add(key);
          }
        });
      }
    }
  }
}

/*async function findUnusedImages(directoryPath, warnings) {
  const referencedImages = new Map(); // Map<imgName, Set<"filePath|lineNumber">>
  const existingImages = new Set();

  await scanDirectory(directoryPath, referencedImages, existingImages);

  for (const img of existingImages) {
    if (!referencedImages.has(img)) {
      const warningKey = `unused|${img}`;

      if (!isWarningDuplicate(warnings, warningKey)) {
        warnings.push({
          filePath: directoryPath,
          fileName: img,
          type: "📁 Unused Image File",
          message: `The image '${img}' exists in the project but is never referenced in code files.`,
          lineNumber: null,
          warningKey,
        });
      }
    }
  }
}*/

//This function used for unused images
async function scanDirectory_unused(dirPath, referencedImages, existingImages) {
  const entries = await fs.readdir(dirPath);

  for (const entry of entries) {
    if (config.ignoreDirectories.includes(entry)) continue;

    const fullPath = path.join(dirPath, entry);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      await scanDirectory_unused(fullPath, referencedImages, existingImages); // Recursive call for subdirectories
    } else {
      const ext = path.extname(entry).toLowerCase();

      // Check if the file is an image
      if (
        [".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".avif"].includes(
          ext
        )
      ) {
        // Store image with its full path (for folder-wise check)
        if (!existingImages.has(entry)) {
          existingImages.set(entry, []); // Initialize an empty array for storing paths
        }
        existingImages.get(entry).push(fullPath); // Add the full path to the image
      }

      // Check for code files to look for referenced images
      if (
        [".html", ".php", ".js", ".jsx", ".ts", ".tsx", ".css"].includes(ext)
      ) {
        const content = await fs.readFile(fullPath, "utf-8");
        const $ = cheerio.load(content);
        const lines = content.split("\n");

        $("img").each((_, el) => {
          const src = $(el).attr("src");
          if (!src || src.startsWith("http")) return;

          const img = path.basename(src); // Extract image name from src

          // Find all line numbers where this image is referenced in the code
          const imgLines = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(src)) {
              if (lines[i].includes("#evIgnore")) continue;
              imgLines.push(i + 1); // Line numbers (1-based)
            }
          }

          if (!referencedImages.has(img)) {
            referencedImages.set(img, new Set());
          }

          const refSet = referencedImages.get(img);

          // Add all line numbers for this image
          for (const lineNumber of imgLines) {
            const key = `${fullPath}|${lineNumber}`;
            refSet.add(key);
          }
        });
      }
    }
  }
}

async function findUnusedImages(directoryPath, warnings) {
  const referencedImages = new Map(); // Map<imgName, Set<"filePath|lineNumber">>
  const existingImages = new Map(); // Map<imgName, [fullPath1, fullPath2, ...]>

  await scanDirectory_unused(directoryPath, referencedImages, existingImages);

  for (const [imgName, paths] of existingImages.entries()) {
    if (!referencedImages.has(imgName)) {
      const warningKey = `unused|${imgName}`;

      // Check for duplicates in different folders
      if (paths.length > 1) {
        for (let i = 0; i < paths.length; i++) {
          const fullPath = paths[i];
          const folder = path.dirname(fullPath); // Get the folder of the image
          const duplicateWarningKey = `duplicate|${imgName}|${folder}`;

          if (!isWarningDuplicate(warnings, duplicateWarningKey)) {
            warnings.push({
              filePath: fullPath,
              fileName: imgName,
              type: "📁 Unused Image File",
              message: `The image '${imgName}' exists in the project but is never referenced in code files.`,
              lineNumber: null,
              warningKey: duplicateWarningKey,
            });
          }
        }
      } else {
        // Single image, unused
        const fullPath = paths[0];
        const warningKey = `unused|${imgName}`;

        if (!isWarningDuplicate(warnings, warningKey)) {
          warnings.push({
            filePath: fullPath, // Full path of the image
            fileName: imgName,
            type: "📁 Unused Image File",
            message: `The image '${imgName}' exists in the project but is never referenced in code files.`,
            lineNumber: null,
            warningKey,
          });
        }
      }
    }
  }
}

// End This function used for unused images

// Checking for testing files code
async function testingFiles(directoryPath, warnings, warningSet) {
  //const filePattern = /^[a-z]\.(php|js|ts|jsx|txt)$/i;
  const filePattern =
    /^(test|temp|tmp|sample|example|demo|a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z)\.(php|js|jsx|ts|tsx|txt)$/i;

  if (config.ignoreDirectories.includes(path.basename(directoryPath))) return;

  try {
    // Read the directory asynchronously
    const files = await fs.readdir(directoryPath);

    // Process each item in the directory
    for (const file of files) {
      const fullPath = path.join(directoryPath, file); // Get full file path

      const stat = await fs.stat(fullPath); // Get file stats

      if (stat.isDirectory() && !config.ignoreDirectories.includes(file)) {
        // If it's a directory, recurse into it
        await testingFiles(fullPath, warnings, warningSet);
      } else if (filePattern.test(file)) {
        // If it's a matching file, check it
        const warningKey = `testingFiles|${fullPath}`;

        // Check if this warning for the file has already been logged
        if (warningSet.has(warningKey)) {
          continue; // Skip if this file has already been processed
        }

        // Prepare the warning message for this specific file
        const warningMessage = `Found matching file: ${file} at ${fullPath}`;

        // Check if this warning already exists in the warnings array
        if (
          warnings.some(
            (warning) =>
              warning.filePath === directoryPath &&
              warning.fileName === file &&
              warning.type === "⚠️ Matching file found"
          )
        ) {
          continue; // Skip if this warning is a duplicate
        }

        // Add the warning for this specific file
        warnings.push({
          filePath: directoryPath,
          fileName: file,
          fullFilePath: fullPath, // Store the full path here
          type: "⚠️ Matching file found",
          message: warningMessage,
          lineNumber: "N/A",
        });

        // Add the warning to the Set to track it
        warningSet.add(warningKey);
      }
    }

    return { warnings, warningSet };
  } catch (err) {
    // Handle any errors when reading the directory
    const errorMessage = `Error reading directory: ${err.message}`;
    const errorKey = `testingFiles|${directoryPath}|${errorMessage}`;

    // Check if the error warning has already been logged
    if (warningSet.has(errorKey)) {
      return { warnings, warningSet }; // Skip if this error warning has already been logged
    }

    // Add the error warning to the warnings list
    warnings.push({
      filePath: directoryPath,
      fileName: "N/A",
      fullFilePath: "N/A",
      type: "⚠️ Error reading directory",
      message: errorMessage,
      lineNumber: "N/A",
    });

    // Add the error to the Set to track it
    warningSet.add(errorKey);

    // Return both warnings and warningSet
    return { warnings, warningSet };
  }
}
// Testing files end

// Checking for http urls

async function findhttpUrls(directoryPath, warnings) {
  const entries = await fs.promises.readdir(directoryPath, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (config.ignoreDirectories.includes(entry.name)) {
        continue; // 🚫 Skip ignored directory
      }
      await findhttpUrls(fullPath, warnings); // Recursive call
    } else if (entry.isFile()) {
      const rl = readline.createInterface({
        input: fs.createReadStream(fullPath),
        crlfDelay: Infinity,
      });

      let lineNumber = 0;

      for await (const line of rl) {
        lineNumber++;

        const matches = line.match(/http:\/\/[^\s"'<>]+/g); // Match all http:// URLs
        if (matches) {
          for (const url of matches) {
            const warningKey = `insecure|${url}|${fullPath}|${lineNumber}`;

            if (!isWarningDuplicate(warnings, warningKey)) {
              warnings.push({
                filePath: fullPath,
                fileName: path.basename(fullPath),
                type: "🔓 Insecure URL",
                message: `The URL '${url}' uses 'http://' and should be updated to 'https://'.`,
                lineNumber,
                warningKey,
              });
            }
          }
        }
      }
    }
  }
}

export {
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
  findMissingImages,
  findUnusedImages,
  testingFiles,
  checkDotHtmlLinkInAnchor,
  checkForOldProjectDomains,
  findhttpUrls,
};
