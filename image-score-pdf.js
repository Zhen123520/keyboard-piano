(function initScoreImagePdf(globalScope) {
  "use strict";

  const A4_PORTRAIT = Object.freeze({ width: 595.276, height: 841.89 });
  const encoder = new TextEncoder();

  function textBytes(value) {
    return encoder.encode(String(value));
  }

  function formatNumber(value) {
    return Number(value).toFixed(3).replace(/\.?0+$/, "");
  }

  function utf16Hex(value) {
    let result = "FEFF";
    for (let index = 0; index < String(value).length; index += 1) {
      result += String(value).charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
    }
    return result;
  }

  function pdfDate(value = new Date()) {
    const pad = (part) => String(part).padStart(2, "0");
    return `D:${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}`
      + `${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`;
  }

  function normalizeBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError("PDF 页面缺少有效的 JPEG 数据");
  }

  function pageGeometry(imageWidth, imageHeight, margin = 14.174) {
    const landscape = imageWidth / imageHeight > 1.08;
    const pageWidth = landscape ? A4_PORTRAIT.height : A4_PORTRAIT.width;
    const pageHeight = landscape ? A4_PORTRAIT.width : A4_PORTRAIT.height;
    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;
    const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    return {
      pageWidth,
      pageHeight,
      drawWidth,
      drawHeight,
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
    };
  }

  function buildPdf(rawPages, options = {}) {
    const pages = Array.from(rawPages || []).map((page, index) => {
      const width = Math.round(Number(page?.width) || 0);
      const height = Math.round(Number(page?.height) || 0);
      const jpegBytes = normalizeBytes(page?.jpegBytes);
      if (width < 1 || height < 1 || jpegBytes.length < 4) {
        throw new Error(`第 ${index + 1} 页不是有效图片`);
      }
      return { width, height, jpegBytes };
    });
    if (!pages.length) throw new Error("没有可写入 PDF 的图片页面");

    const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);
    const infoObjectNumber = 3 + pages.length * 3;
    const objectCount = infoObjectNumber;
    const offsets = new Array(objectCount + 1).fill(0);
    const chunks = [];
    let byteLength = 0;

    const append = (part) => {
      const bytes = typeof part === "string" ? textBytes(part) : normalizeBytes(part);
      chunks.push(bytes);
      byteLength += bytes.byteLength;
    };
    const addObject = (number, parts) => {
      offsets[number] = byteLength;
      append(`${number} 0 obj\n`);
      for (const part of parts) append(part);
      append("\nendobj\n");
    };

    append("%PDF-1.7\n%");
    append(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
    addObject(2, [
      `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] >>`,
    ]);

    pages.forEach((page, index) => {
      const pageObjectNumber = pageObjectNumbers[index];
      const contentObjectNumber = pageObjectNumber + 1;
      const imageObjectNumber = pageObjectNumber + 2;
      const imageName = `Im${index + 1}`;
      const geometry = pageGeometry(page.width, page.height, Number(options.margin) || 14.174);
      const content = [
        "q",
        "1 1 1 rg",
        `0 0 ${formatNumber(geometry.pageWidth)} ${formatNumber(geometry.pageHeight)} re f`,
        `${formatNumber(geometry.drawWidth)} 0 0 ${formatNumber(geometry.drawHeight)} ${formatNumber(geometry.x)} ${formatNumber(geometry.y)} cm`,
        `/${imageName} Do`,
        "Q",
        "",
      ].join("\n");
      const contentBytes = textBytes(content);

      addObject(pageObjectNumber, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(geometry.pageWidth)} ${formatNumber(geometry.pageHeight)}] `,
        `/Resources << /ProcSet [/PDF /ImageC] /XObject << /${imageName} ${imageObjectNumber} 0 R >> >> `,
        `/Contents ${contentObjectNumber} 0 R >>`,
      ]);
      addObject(contentObjectNumber, [
        `<< /Length ${contentBytes.byteLength} >>\nstream\n`,
        contentBytes,
        "endstream",
      ]);
      addObject(imageObjectNumber, [
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} `,
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate true /Filter /DCTDecode `,
        `/Length ${page.jpegBytes.byteLength} >>\nstream\n`,
        page.jpegBytes,
        "\nendstream",
      ]);
    });

    const title = String(options.title || "图片简谱").slice(0, 160);
    addObject(infoObjectNumber, [
      `<< /Title <${utf16Hex(title)}> /Producer (Keyboard Piano Image Score PDF) `,
      `/CreationDate (${pdfDate(options.createdAt instanceof Date ? options.createdAt : new Date())}) >>`,
    ]);

    const xrefOffset = byteLength;
    append(`xref\n0 ${objectCount + 1}\n`);
    append("0000000000 65535 f \n");
    for (let number = 1; number <= objectCount; number += 1) {
      append(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
    }
    append(
      `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoObjectNumber} 0 R >>\n`
      + `startxref\n${xrefOffset}\n%%EOF\n`,
    );

    const output = new Uint8Array(byteLength);
    let outputOffset = 0;
    for (const chunk of chunks) {
      output.set(chunk, outputOffset);
      outputOffset += chunk.byteLength;
    }
    return output;
  }

  const api = Object.freeze({ buildPdf, pageGeometry });
  globalScope.ScoreImagePdf = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : self);
