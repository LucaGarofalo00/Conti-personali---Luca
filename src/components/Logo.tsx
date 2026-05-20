export default function Logo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4F46E5" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="url(#logoGrad)" />
      <g fill="none" stroke="#ffffff" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round">
        <path d="M96 336 L200 232 L280 312 L416 176" />
        <path d="M320 176 H416 V272" />
      </g>
    </svg>
  )
}
