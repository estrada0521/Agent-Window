    const extractFrontmatter = (text) => {
      const raw = String(text ?? "");
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
      if (!match) return null;
      return { yamlText: match[1], body: raw.slice(match[0].length) };
    };
    const parseSimpleFrontmatter = (yamlText) => {
      const lines = String(yamlText ?? "").split(/\r?\n/);
      const root = {};
      const stack = [{ indent: -1, obj: root }];
      let i = 0;
      while (i < lines.length) {
        const rawLine = lines[i];
        if (!rawLine.trim()) { i += 1; continue; }
        const indent = rawLine.match(/^\s*/)[0].length;
        const match = rawLine.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (!match) { i += 1; continue; }
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
        const parent = stack[stack.length - 1].obj;
        let value = match[2];
        // YAML block scalars ("key: |" literal, "key: >" folded, with
        // optional -/+ chomping indicator): the value lives in the
        // following more-indented lines, not on this line.
        const blockMatch = value.match(/^([|>])([+-]?)\d*$/);
        if (blockMatch) {
          const [, style, chomp] = blockMatch;
          const blockLines = [];
          let j = i + 1;
          let blockIndent = null;
          while (j < lines.length) {
            const line = lines[j];
            if (!line.trim()) { blockLines.push(""); j += 1; continue; }
            const lineIndent = line.match(/^\s*/)[0].length;
            if (lineIndent <= indent) break;
            if (blockIndent === null) blockIndent = lineIndent;
            blockLines.push(line.slice(blockIndent));
            j += 1;
          }
          while (blockLines.length && blockLines[blockLines.length - 1] === "") blockLines.pop();
          let text;
          if (style === "|") {
            text = blockLines.join("\n");
          } else {
            const parts = [];
            let para = [];
            for (const line of blockLines) {
              if (line === "") {
                if (para.length) { parts.push(para.join(" ")); para = []; }
                parts.push("");
              } else {
                para.push(line);
              }
            }
            if (para.length) parts.push(para.join(" "));
            text = parts.join("\n");
          }
          if (chomp !== "+") text = text.replace(/\n+$/, "");
          parent[match[1]] = text;
          i = j;
          continue;
        }
        if (value === "") {
          const child = {};
          parent[match[1]] = child;
          stack.push({ indent, obj: child });
        } else {
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1).replace(/\\"/g, '"');
          }
          parent[match[1]] = value;
        }
        i += 1;
      }
      return root;
    };
    const frontmatterTableHtml = (obj) => {
      const rows = Object.entries(obj).map(([key, value]) => {
        const valueHtml = value && typeof value === "object"
          ? frontmatterTableHtml(value)
          : escapeHtml(String(value)).replace(/\n/g, "<br>");
        return `<tr><td class="md-frontmatter-key">${escapeHtml(key)}</td><td>${valueHtml}</td></tr>`;
      }).join("");
      return `<table class="md-frontmatter"><tbody>${rows}</tbody></table>`;
    };
