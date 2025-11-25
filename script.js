// Navigation scroll effect
window.addEventListener('scroll', function() {
    const nav = document.querySelector('.modern-nav');
    if (window.scrollY > 50) {
        nav.classList.add('scrolled');
    } else {
        nav.classList.remove('scrolled');
    }
});

// Scroll to functions
function scrollToDownload() {
    document.getElementById('download').scrollIntoView({ 
        behavior: 'smooth',
        block: 'start'
    });
}

function scrollToFeatures() {
    document.getElementById('features').scrollIntoView({ 
        behavior: 'smooth',
        block: 'start'
    });
}

// Intersection Observer for scroll animations
const observerOptions = {
    threshold: 0.3,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, observerOptions);

// Observe all elements that need scroll animations
document.addEventListener('DOMContentLoaded', function() {
    // Feature cards
    document.querySelectorAll('.feature-card').forEach(card => {
        observer.observe(card);
    });
    
    // Section content
    document.querySelectorAll('.section-content, .section-visual').forEach(section => {
        observer.observe(section);
    });
    
    // Animate stats counting
    animateStats();
});

// Animate statistics counting
function animateStats() {
    const statElements = document.querySelectorAll('.stat-number');
    
    statElements.forEach(stat => {
        const target = parseInt(stat.getAttribute('data-count'));
        const duration = 2000; // 2 seconds
        const increment = target / (duration / 16); // 60fps
        let current = 0;
        
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                stat.textContent = target + (stat.textContent.includes('.') ? '.0' : '');
                clearInterval(timer);
            } else {
                stat.textContent = Math.round(current) + (stat.textContent.includes('.') ? '.0' : '');
            }
        }, 16);
    });
}

// Mobile navigation toggle
function toggleMobileMenu() {
    const navMenu = document.querySelector('.nav-menu');
    navMenu.classList.toggle('active');
}

// Add event listener for mobile menu
document.querySelector('.nav-toggle').addEventListener('click', toggleMobileMenu);

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Parallax effect for hero section
window.addEventListener('scroll', function() {
    const scrolled = window.pageYOffset;
    const parallaxElements = document.querySelectorAll('.floating-shapes .shape');
    
    parallaxElements.forEach((shape, index) => {
        const speed = 0.5 + (index * 0.1);
        shape.style.transform = `translateY(${scrolled * speed * 0.1}px)`;
    });
});

// Hover effects for platform cards
document.querySelectorAll('.platform-card').forEach(card => {
    card.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-10px) scale(1.05)';
        this.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.3)';
    });
    
    card.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0) scale(1)';
        this.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.2)';
    });
});

// Loading animation
window.addEventListener('load', function() {
    document.body.classList.add('loaded');
});
