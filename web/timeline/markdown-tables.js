    const ensureWideTables = (scope = document) => {
      const tables = [];
      scope.querySelectorAll(".md-body table").forEach((table) => {
        if (!table.closest(".table-scroll")) {
          const scroll = document.createElement("div");
          scroll.className = "table-scroll";
          table.before(scroll);
          scroll.appendChild(table);
        }
        if (table.classList.contains("md-frontmatter") || table.dataset.columnsSized || table.closest("details:not([open])") || !table.getClientRects().length) return;
        tables.push(table);
      });
      tables.forEach((table) => table.classList.add("measuring-columns"));
      const widths = tables.map((table) => Array.from(table.rows).flatMap((row) => Array.from(row.cells)).map((cell) => {
        const style = getComputedStyle(cell);
        const fontSize = parseFloat(style.fontSize);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const contentWidth = cell.getBoundingClientRect().width - padding;
        return [cell, Math.min(8, contentWidth / fontSize) + padding / fontSize];
      }));
      tables.forEach((table, index) => {
        widths[index].forEach(([cell, width]) => { cell.style.minWidth = `${width}em`; });
        table.classList.remove("measuring-columns");
        table.dataset.columnsSized = "true";
      });
    };
    document.addEventListener("toggle", (event) => {
      if (event.target.matches(".md-body details[open]")) ensureWideTables(event.target);
    }, true);
