// src/components/Reveal.jsx
import { motion } from 'framer-motion';

export default function Reveal({ children, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }} // Começa invisível e 50px para baixo
      whileInView={{ opacity: 1, y: 0 }} // Quando visível, fica opaco e sobe
      viewport={{ once: true, margin: "-100px" }} // Acontece só uma vez
      transition={{ duration: 0.6, delay: delay, ease: "easeOut" }} // Duração da animação
    >
      {children}
    </motion.div>
  );
}