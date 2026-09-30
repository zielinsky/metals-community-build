document.querySelectorAll("details.log-viewer").forEach((details) => {
  details.addEventListener("toggle", async () => {
    if (!details.open || details.dataset.loaded) return;
    details.dataset.loaded = "true";
    const viewer = details.querySelector("pre[data-source]");
    try {
      const response = await fetch(viewer.dataset.source);
      const text = await response.text();
      viewer.textContent = viewer.dataset.format === "json"
        ? JSON.stringify(JSON.parse(text), null, 2)
        : text;
    } catch (error) {
      viewer.textContent = String(error);
    }
  });
});

const galleryLinks = [...document.querySelectorAll("a[data-gallery]")];
if (galleryLinks.length) {
  const lightbox = document.createElement("dialog");
  lightbox.className = "lightbox";
  lightbox.innerHTML =
    '<button class="lightbox-close" type="button" aria-label="Close screenshot">×</button>' +
    '<button class="lightbox-previous" type="button" aria-label="Previous screenshot">←</button>' +
    '<figure><img alt=""><figcaption></figcaption></figure>' +
    '<button class="lightbox-next" type="button" aria-label="Next screenshot">→</button>';
  document.body.append(lightbox);

  const image = lightbox.querySelector("img");
  const caption = lightbox.querySelector("figcaption");
  const previous = lightbox.querySelector(".lightbox-previous");
  const next = lightbox.querySelector(".lightbox-next");
  let currentGallery = [];
  let currentIndex = 0;

  const show = (index) => {
    currentIndex = (index + currentGallery.length) % currentGallery.length;
    const link = currentGallery[currentIndex];
    image.src = link.href;
    image.alt = link.dataset.caption;
    caption.textContent =
      link.dataset.caption + " · " + (currentIndex + 1) + "/" + currentGallery.length;
    const hasMultiple = currentGallery.length > 1;
    previous.hidden = !hasMultiple;
    next.hidden = !hasMultiple;
  };
  const move = (offset) => show(currentIndex + offset);

  galleryLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      currentGallery = galleryLinks.filter(
        (candidate) => candidate.dataset.gallery === link.dataset.gallery,
      );
      show(currentGallery.indexOf(link));
      lightbox.showModal();
    });
  });
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  lightbox.querySelector(".lightbox-close").addEventListener("click", () =>
    lightbox.close(),
  );
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) lightbox.close();
  });
  lightbox.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  });
}
