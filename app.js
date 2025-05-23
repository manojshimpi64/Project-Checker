const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const cheerio = require("cheerio");
const bodyParser = require("body-parser");

const {
  ignoreDirectories,
  globalProjectVariables,
  ignoreFileFiles,
} = require("./config");
const generateExcel = require("./utils/exportExcel");
const generatePdf = require("./utils/exportPdf");
const {
  checkForMissingAltAttributes,
  checkForInvalidMailtoLinks,
  removeConsoleLogs,
  checkForEmptyFiles,
  checkForBrokenLinks,
  checkForHtmlComments,
  checkForGlobalProjectVariablesMissing,
  checkForMissingFooter,
  getAllFolders,
  checkFolderForMissingIndexPhp,
  findUnusedImages,
  findMissingImages,
} = require("./utils/globalFunction");

const app = express();

// Middleware setup
app.set("view engine", "ejs");
app.use(express.static("public"));

app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("/export/pdf", (req, res) => {
  const warnings = JSON.parse(req.body.data || "[]");
  generatePdf(warnings, res);
});

app.post("/export/excel", async (req, res) => {
  const warnings = JSON.parse(req.body.data || "[]");
  await generateExcel(warnings, res);
});

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

  //start - global
  const allFolders = await getAllFolders(basePath); // "basePath" is equal to "directoryPath"

  switch (checkOption) {
    case "showAll":
      checkForMissingAltAttributes($, warnings, filePath, fileName, content);
      checkForInvalidMailtoLinks($, warnings, filePath, fileName, content);
      await removeConsoleLogs($, warnings, filePath, fileName, content);
      await checkForEmptyFiles($, warnings, filePath, fileName, content);
      checkForHtmlComments($, warnings, filePath, fileName, content);
      await findMissingImages(basePath, warnings);
      await findUnusedImages(basePath, warnings);

      //start - Scan all folders (including empty ones)
      for (const folder of allFolders) {
        await checkFolderForMissingIndexPhp(folder, warnings);
      }
      //end

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
    case "invalidMailtoLinks":
      checkForInvalidMailtoLinks($, warnings, filePath, fileName, content);
      break;
    case "consoleLogs":
      await removeConsoleLogs($, warnings, filePath, fileName, content);
      break;
    case "checkForEmptyFiles":
      await checkForEmptyFiles($, warnings, filePath, fileName, content);
      break;
    case "findMissingImages":
      await findMissingImages(basePath, warnings);
      break;
    case "findUnusedImages":
      await findUnusedImages(basePath, warnings);
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
    case "missingIndexPhp":
      for (const folder of allFolders) {
        await checkFolderForMissingIndexPhp(folder, warnings);
      }
      break;
  }
}

// Start server
app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
