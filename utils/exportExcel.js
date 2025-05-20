const ExcelJS = require("exceljs");

function getFormattedDate() {
  const date = new Date();
  return `${String(date.getDate()).padStart(2, "0")}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${date.getFullYear()}`;
}

async function generateExcel(warnings, res) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Code Checker Report");

  worksheet.columns = [
    { header: "#", key: "index", width: 5 },
    { header: "File Path", key: "filePath", width: 40 },
    { header: "File Name", key: "fileName", width: 25 },
    { header: "Line Number", key: "lineNumber", width: 10 },
    { header: "Type", key: "type", width: 25 },
    { header: "Message", key: "message", width: 50 },
  ];

  warnings.forEach((item, index) => {
    worksheet.addRow({
      index: index + 1,
      filePath: item.filePath,
      fileName: item.fileName,
      lineNumber: item.lineNumber || "",
      type: item.type,
      message: item.message,
    });
  });

  const dateStr = getFormattedDate();

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=checking_report_${dateStr}.xlsx`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  await workbook.xlsx.write(res);
  res.end();
}

module.exports = generateExcel;
