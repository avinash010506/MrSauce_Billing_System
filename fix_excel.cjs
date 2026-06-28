const fs = require("fs");
let content = fs.readFileSync("src/routes/_app/statements.tsx", "utf8");

// Replace exportCSV references
content = content.replace(/function exportCSV/g, "async function exportExcel");
content = content.replace(/exportCSV\(/g, "exportExcel(");
content = content.replace(/\.csv/g, ".xlsx");
content = content.replace(/ CSV/g, " Excel");

// Add imports
content = content.replace(
  `import { toast } from "sonner";\r\nimport { Download, FileText } from "lucide-react";`,
  `import { toast } from "sonner";\r\nimport { Download, FileText } from "lucide-react";\r\nimport ExcelJS from "exceljs";\r\nimport { saveAs } from "file-saver";`,
);

content = content.replace(
  `import { toast } from "sonner";\nimport { Download, FileText } from "lucide-react";`,
  `import { toast } from "sonner";\nimport { Download, FileText } from "lucide-react";\nimport ExcelJS from "exceljs";\nimport { saveAs } from "file-saver";`,
);

// Replace implementation
const oldFunc = `async function exportExcel(rows: (string | number)[][], filename: string) {
  const csv = rows
    .map((r) => r.map((c) => \`"\${String(c).replace(/"/g, '""')}"\`).join(","))
    .join("\\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  toast.success(\`\${filename} downloaded\`);
}`;

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

// Try replacing with CRLF and LF variations of the old function since it could be either in the file
content = content.replace(oldFunc.replace(/\n/g, "\r\n"), newFunc);
content = content.replace(oldFunc, newFunc);

fs.writeFileSync("src/routes/_app/statements.tsx", content);
console.log("Done");
