      const LARGE_PASTE_TEXT_CHARS = 32_768;

      const uploadAttachedFiles = async (fileList) => {
        if (!canCompose()) return false;
        const files = Array.from(fileList || []).filter((f) => f && typeof f.name === "string");
        if (!files.length) return false;
        try {
          await Promise.all(files.map(async (file) => {
            const card = beginAttachCard(file);
            attachUploadsInFlight += 1;
            try {
              const res = await fetch("/upload", {
                method: "POST",
                headers: {
                  "Content-Type": file.type || "application/octet-stream",
                  "X-Filename": encodeURIComponent(file.name || "upload.bin"),
                },
                body: file,
                signal: card.signal,
              });
              if (card.cancelled) return;
              const data = await res.json();
              if (!res.ok || !data.ok) throw new Error(data.error || "upload failed");
              if (card.cancelled) return;
              const attachment = { path: data.path, name: file.name };
              pendingAttachments.push(attachment);
              card.complete(attachment);
              updateSendBtnVisibility();
            } catch (err) {
              if (card.cancelled || err?.name === "AbortError") return;
              card.discard();
              throw err;
            } finally {
              attachUploadsInFlight = Math.max(0, attachUploadsInFlight - 1);
            }
          }));
          return true;
        } catch (err) {
          setStatus("upload failed: " + err.message);
          return false;
        }
      };

      const uploadLargePastedText = async (text) => {
        if (typeof text !== "string" || text.length <= LARGE_PASTE_TEXT_CHARS) return false;
        const file = new File([text], "pasted.txt", { type: "text/plain" });
        return uploadAttachedFiles([file]);
      };
