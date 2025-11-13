// Smooth scrolling function
function scrollToSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

function scrollToDownload() {
    scrollToSection('download');
}

function scrollToFeatures() {
    scrollToSection('features');
}

// Navigation scroll effect
let lastScrollY = window.scrollY;
const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
    const currentScrollY = window.scrollY;
    
    if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // Scroll down - hide navbar
        navbar.style.transform = 'translateY(-100%)';
    } else {
        // Scroll up or at top - show navbar
        navbar.style.transform = 'translateY(0)';
    }
    
    lastScrollY = currentScrollY;
});

// Animation effects - scroll reveal
function initAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe elements that need animation
    const animatedElements = document.querySelectorAll('.feature-card, .comparison-table, .download-btn');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

// App store button click effect
document.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Add click animation effect
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = '';
        }, 150);
        
        // Show download prompt (in real project should link to app store)
        alert('Redirecting to app store download page');
    });
});

// Initialize after page load
document.addEventListener('DOMContentLoaded', function() {
    // Initialize animations
    initAnimations();
    
    // Add hover effects to feature cards
    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.querySelector('.feature-icon').style.transform = 'scale(1.1)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.querySelector('.feature-icon').style.transform = 'scale(1)';
        });
    });
    
    // Console welcome message
    console.log('%c📚 Studyflow - Smart Learning Management App', 
        'color: #2563eb; font-size: 18px; font-weight: bold;');
    console.log('%cWelcome to the Studyflow official website!', 
        'color: #64748b; font-size: 14px;');
    
    // Enhanced navigation effects and number counting animation
    setupNavigationEffects();
    startNumberCounting();
    setupSparkleEffects();
});

// Performance optimization - Lazy loading images
if ('IntersectionObserver' in window) {
    const lazyImages = document.querySelectorAll('img[data-src]');
    
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });

    lazyImages.forEach(img => {
        imageObserver.observe(img);
    });
}

// Error handling
window.addEventListener('error', function(e) {
    console.error('Page error:', e.error);
});

// Keyboard navigation support
document.addEventListener('keydown', function(e) {
    // ESC key to close all modals (if any)
    if (e.key === 'Escape') {
        console.log('ESC pressed - closing modals');
    }
    
    // Space key for scrolling
    if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        window.scrollBy(0, window.innerHeight * 0.8);
    }
});

// Mobile touch optimization
function setupMobileTouch() {
    let lastTouchY = 0;
    
    document.addEventListener('touchstart', function(e) {
        lastTouchY = e.touches[0].clientY;
    });
    
    document.addEventListener('touchmove', function(e) {
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - lastTouchY;
        
        // Quick swipe down to refresh page
        if (deltaY > 100 && currentY < 100) {
            window.location.reload();
        }
        
        lastTouchY = currentY;
    });
}

// Enhanced navigation effects
function setupNavigationEffects() {
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });
    
    // Add click effects to navigation links
    const navLinks = document.querySelectorAll('.nav-menu a');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = '';
            }, 150);
        });
    });
}

// Number counting animation
function startNumberCounting() {
    const statNumbers = document.querySelectorAll('.stat-number');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const numberElement = entry.target;
                const targetValue = parseFloat(numberElement.getAttribute('data-count'));
                const isDecimal = targetValue % 1 !== 0;
                const duration = 2000;
                const startTime = performance.now();
                
                function animateNumber(currentTime) {
                    const elapsedTime = currentTime - startTime;
                    const progress = Math.min(elapsedTime / duration, 1);
                    
                    let currentValue;
                    if (isDecimal) {
                        currentValue = (targetValue * progress).toFixed(1);
                    } else {
                        currentValue = Math.floor(targetValue * progress);
                    }
                    
                    numberElement.textContent = isDecimal ? currentValue : currentValue + (targetValue > 24 ? '%' : '');
                    
                    if (progress < 1) {
                        requestAnimationFrame(animateNumber);
                    }
                }
                
                requestAnimationFrame(animateNumber);
                observer.unobserve(numberElement);
            }
        });
    }, { threshold: 0.5 });
    
    statNumbers.forEach(number => observer.observe(number));
}

// Sparkle effects for buttons
function setupSparkleEffects() {
    const primaryButtons = document.querySelectorAll('.btn-primary');
    
    primaryButtons.forEach(button => {
        button.addEventListener('mouseenter', function() {
            createSparkles(this);
        });
    });
    
    function createSparkles(button) {
        const buttonRect = button.getBoundingClientRect();
        
        for (let i = 0; i < 5; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'btn-sparkle';
            
            // Random positions within button
            const x = Math.random() * buttonRect.width - 10;
            const y = Math.random() * buttonRect.height - 10;
            
            sparkle.style.setProperty('--sparkle-x', `${x}px`);
            sparkle.style.setProperty('--sparkle-y', `${y}px`);
            
            button.appendChild(sparkle);
            
            // Remove sparkle after animation
            setTimeout(() => {
                if (sparkle.parentNode === button) {
                    button.removeChild(sparkle);
                }
            }, 2000);
        }
    }
}