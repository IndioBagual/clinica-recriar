export const SITE_CONFIG = {
  nome: 'Clínica Recriar',
  slogan: 'Cuidado integrado para uma vida plena.',
  urlBase: process.env.NEXT_PUBLIC_SITE_URL || 'https://clinicarecriar.com.br',
  telefoneExibicao: '(53) 99128-1500',
  whatsappNumero: '5553991281500',
  email: 'clinicarecriar.rg@gmail.com',
  redesSociais: {
    facebook: 'https://www.facebook.com/clinicarecriarrg',
    instagram: 'https://www.instagram.com/clinicarecriarrg/',
  },
  navPrincipal: [
    { label: 'Início', href: '/' },
    { label: 'A Clínica', href: '/a-clinica' },
    { label: 'Nossa Equipe', href: '/equipe' },
    { label: 'Serviços', href: '/servicos' },
    { label: 'Convênios', href: '/convenios' },
    { label: 'Espaço de Escuta', href: '/escuta' },
    { label: 'Eventos', href: '/eventos' },
    { label: 'Unidades e Contato', href: '/contato' },
  ],
};

export function criarLinkWhatsapp(
  mensagem = 'Olá, gostaria de marcar uma consulta na Clínica Recriar.',
  numero = SITE_CONFIG.whatsappNumero
) {
  return `https://api.whatsapp.com/send/?phone=${numero}&text=${encodeURIComponent(mensagem)}`;
}

export const UNIDADES = {
  tiradentes: {
    id: 'Tiradentes',
    slug: 'tiradentes',
    nome: 'Unidade Tiradentes',
    rota: '/unidades/tiradentes',
    enderecoCurto: 'Rua Tiradentes, 20',
    bairroCidade: 'Cidade Nova, Rio Grande - RS',
    enderecoCompleto: 'Rua Tiradentes, 20, Cidade Nova, Rio Grande - RS, CEP 96211-080',
    whatsapp: '5553991281500',
    mapaLink: 'https://maps.app.goo.gl/e5gR6cdYBhh336rR6',
    mapaSrc:
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d6764.258740564183!2d-52.107571623630086!3d-32.038689526611776!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x95119c09954a74d9%3A0x55f925d82ada53af!2sR.%20Tiradentes%2C%2020%20-%20Cidade%20Nova%2C%20Rio%20Grande%20-%20RS%2C%2096211-080!5e0!3m2!1spt-BR!2sbr!4v1780942209820!5m2!1spt-BR!2sbr',
    fotoFachada: '/img/frente.jpg',
  },
  abreu: {
    id: 'Abreu',
    slug: 'abreu',
    nome: 'Unidade Abreu',
    rota: '/unidades/abreu',
    enderecoCurto: 'Rua General Abreu, 52',
    bairroCidade: 'Cidade Nova, Rio Grande - RS',
    enderecoCompleto: 'Rua General Abreu, 52, Cidade Nova, Rio Grande - RS',
    whatsapp: '5553991281500',
    mapaLink: 'https://maps.app.goo.gl/AMDchxDPA7D3r5Y27',
    mapaSrc:
      'https://maps.google.com/maps?q=Rua%20General%20Abreu%2C%2052%20-%20Bairro%20Cidade%20Nova%2C%20Rio%20Grande%20-%20RS&t=&z=15&ie=UTF8&iwloc=&output=embed',
    fotoFachada: '/img/frente.jpg',
  },
};

export const LISTA_UNIDADES = [UNIDADES.tiradentes, UNIDADES.abreu];