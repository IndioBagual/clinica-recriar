export default function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  className = '',
}) {
  const alignment =
    align === 'left' ? 'text-left items-start' : 'text-center items-center mx-auto';

  return (
    <div className={`flex flex-col max-w-3xl ${alignment} ${className}`}>
      {eyebrow && (
        <span className="inline-flex items-center gap-2 rounded-full bg-sage-100 px-3.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
          {eyebrow}
        </span>
      )}
      <h2 className="mt-3 font-serif text-3xl md:text-4xl font-semibold tracking-tight text-brand-dark">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base md:text-lg leading-relaxed text-earth-muted">
          {description}
        </p>
      )}
    </div>
  );
}