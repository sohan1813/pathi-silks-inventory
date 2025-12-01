document.addEventListener('DOMContentLoaded', () => {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const closeBtn = document.getElementById('lightbox-close');
  const prevBtn = document.getElementById('lightbox-prev');
  const nextBtn = document.getElementById('lightbox-next');

  if (!lightbox || !lightboxImg || !closeBtn || !prevBtn || !nextBtn) return;

  // All images on page that open in lightbox
  let images = Array.from(document.querySelectorAll('.lb-img'));
  let currentIndex = -1;

  function openAt(index) {
    if (index < 0 || index >= images.length) return;
    currentIndex = index;
    const img = images[currentIndex];
    lightboxImg.src = img.src;
    lightbox.style.display = 'flex';
  }

  function close() {
    lightbox.style.display = 'none';
    lightboxImg.src = '';
    currentIndex = -1;
  }

  function showNext() {
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % images.length;
    openAt(nextIndex);
  }

  function showPrev() {
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + images.length) % images.length;
    openAt(prevIndex);
  }

  // Click any gallery image
  images.forEach((img, index) => {
    img.addEventListener('click', (e) => {
      e.preventDefault();
      openAt(index);
    });
  });

  closeBtn.addEventListener('click', close);

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
      close();
    }
  });

  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showNext();
  });

  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showPrev();
  });

  document.addEventListener('keydown', (e) => {
    if (lightbox.style.display === 'flex') {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') showNext();
      if (e.key === 'ArrowLeft') showPrev();
    }
  });
});
