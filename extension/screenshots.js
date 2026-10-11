export function setupScreenshots({ request, inputs, onText }) {
  let revision = 0;
  const resets = [];
  for (const source of ['whatsapp', 'fulfillment']) {
    const fileInput = document.getElementById(`${source}Image`), button = document.getElementById(`${source}Scan`), status = document.getElementById(`${source}ScanStatus`);
    let image = '', mimeType = '', busy = false, version = 0;
    const accept = async file => {
      const current = ++version; image = ''; button.disabled = true;
      if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        status.textContent = 'Choose a PNG, JPEG, or WebP image up to 10 MB.'; return;
      }
      const reader = new FileReader();
      reader.onload = () => { if (current === version) { image = String(reader.result); mimeType = file.type; button.disabled = busy; status.textContent = 'Image ready. Click Scan and review the extracted text.'; } };
      reader.onerror = () => { status.textContent = 'Could not read the image.'; };
      reader.readAsDataURL(file);
    };
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) void accept(fileInput.files[0]); });
    document.getElementById(`${source}Text`).addEventListener('paste', event => {
      const file = [...(event.clipboardData?.files || [])].find(file => file.type.startsWith('image/'));
      if (file) { event.preventDefault(); void accept(file); }
    });
    button.addEventListener('click', async () => {
      if (!image || busy) return;
      const current = version, currentRevision = revision, key = inputs(); busy = true; button.disabled = true; status.textContent = 'Scanning…';
      try {
        const data = await request('/api/scan-screenshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auditScope: 'general_auditor', imageBase64: image, mimeType }) });
        if (current !== version || currentRevision !== revision || key !== inputs()) {
          if (current === version && currentRevision !== revision) status.textContent = 'Inputs changed during scanning. Scan again to use this image.';
          return;
        }
        if (!data.text?.trim()) throw new Error('Screenshot returned no text.');
        onText(source, data.text); status.textContent = 'Text extracted. Review it and the product reminders before auditing.';
      } catch (error) { if (current === version && currentRevision === revision) status.textContent = error.message; }
      finally { busy = false; button.disabled = !image; }
    });
    resets.push(() => { version++; image = ''; fileInput.value = ''; status.textContent = ''; button.disabled = true; });
  }
  return { invalidate() { revision++; }, reset() { revision++; resets.forEach(reset => reset()); } };
}
