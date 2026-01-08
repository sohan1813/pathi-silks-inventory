document.addEventListener('DOMContentLoaded', () => {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const closeBtn = document.getElementById('lightbox-close');
  const prevBtn = document.getElementById('lightbox-prev');
  const nextBtn = document.getElementById('lightbox-next');

  const thumbs = Array.from(document.querySelectorAll('.lb-img'));
  let currentIndex = -1;

  function openAt(index) {
    // NEW: disable lightbox while selecting
    if (document.body.classList.contains('select-mode')) return;

    if (index < 0 || index >= thumbs.length) return;
    currentIndex = index;
    const img = thumbs[currentIndex];
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt || '';
    lightbox.style.display = 'flex';
  }

  function close() {
    lightbox.style.display = 'none';
    lightboxImg.src = '';
    currentIndex = -1;
  }

  function showNext() {
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % thumbs.length;
    openAt(nextIndex);
  }

  function showPrev() {
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + thumbs.length) % thumbs.length;
    openAt(prevIndex);
  }

  // Click on thumbnails
  thumbs.forEach((img, index) => {
    img.addEventListener('click', () => {
      // NEW: disable lightbox while selecting
      if (document.body.classList.contains('select-mode')) return;
      openAt(index);
    });
  });

  // Buttons
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (nextBtn) nextBtn.addEventListener('click', showNext);
  if (prevBtn) prevBtn.addEventListener('click', showPrev);

  // Click outside image closes
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) close();
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (lightbox.style.display !== 'flex') return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') showNext();
    if (e.key === 'ArrowLeft') showPrev();
  });
});
