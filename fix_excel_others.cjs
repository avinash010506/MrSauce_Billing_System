const fs = require("fs");

function processFile(path) {
  let content = fs.readFileSync(path, "utf8");

  // Replace exportCSV references
  content = content.replace(/function exportCSV/g, "async function exportExcel");
  content = content.replace(/exportCSV\(/g, "exportExcel(");
  content = content.replace(/\.csv/g, ".xlsx");
  content = content.replace(/ CSV/g, " Excel");

  // Add imports if missing
  if (!content.includes("exceljs")) {
    content = content.replace(
      `import { toast } from "sonner";`,
      `import { toast } from "sonner";\r\nimport ExcelJS from "exceljs";\r\nimport { saveAs } from "file-saver";`,
    );
    // sometimes it's just \n
    content = content.replace(
      `import { toast } from "sonner";`,
      `import { toast } from "sonner";\nimport ExcelJS from "exceljs";\nimport { saveAs } from "file-saver";`,
    );
  }

  const newFunc = `async function exportExcel(rows: (string | number)[][], filename: string) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Statement");

  worksheet.addRows(rows);

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };

  worksheet.columns.forEach((column) => {
    let maxLength = 0;
    column.eachCell!({ includeEmpty: true }, (cell) => {
      const columnLength = cell.value ? cell.value.toString().length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = maxLength < 10 ? 10 : maxLength + 2;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), filename);
  toast.success(\`\${filename} downloaded\`);
}`;

  // Replace old exportCSV function body with exportExcel body by using a regex
  // since the function implementation might vary slightly with spacing or arguments.
  content = content.replace(
    /async function exportExcel\([^\{]+\{[\s\S]+?toast\.success[^\}]+\}/g,
    newFunc,
  );

  // Actually, wait, some files might not have exportCSV defined in them (like maybe they import it? No, they define it).
  // Let's just try to replace the whole block if possible.
  content = content.replace(
    /async function exportExcel\([\s\S]*?toast\.success\([\s\S]*?\n\}/,
    newFunc,
  );

  fs.writeFileSync(path, content);
}

processFile("src/routes/_app/customers.tsx");
processFile("src/routes/_app/vendors.tsx");
processFile("src/routes/_app/reports.tsx");

console.log("Done");
