// utils/exportPdf.js
const PDFDocument = require("pdfkit");

function generatePdf(warnings, res) {
  const doc = new PDFDocument();

  res.setHeader("Content-disposition", "attachment; filename=report.pdf");
  res.setHeader("Content-type", "application/pdf");

  doc.pipe(res);

  doc.fontSize(18).text("Code Checker Report", { underline: true });
  doc.moveDown();

  warnings.forEach((item, index) => {
    doc.fontSize(10).text(
      `${index + 1}. File: ${item.fileName}
Path: ${item.filePath}
Line: ${item.lineNumber || "N/A"}
Type: ${item.type}
Message: ${item.message}`,
      {
        paragraphGap: 10,
      }
    );
    doc.moveDown();
  });

  doc.end();
}

module.exports = generatePdf;
