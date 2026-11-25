import { motion, useReducedMotion } from 'framer-motion';

export default function Reveal({ children, delay = 0, className = '' }) {
  const shouldReduceMotion = useReducedMotion();
  const safeDelay = Math.min(delay, 0.35);

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay: safeDelay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}