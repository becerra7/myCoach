/* Datos de ejemplo del prototipo. Las salidas de bici salen del análisis del 3 de octubre;
   lo que no estaba en ese análisis (velocidades, comidas, calendario) es inventado y se marca así. */
const HOY = '2026-10-04';

const ESTADO = {
  color: 'verde',
  decision: 'Rodaje suave en llano, 75 min',
  porque: 'Dormiste 7 h 40 y la VFC está en tu normal. Ayer apretaste: hoy toca soltar piernas.',
  ruta: { nombre: 'La Roca, llano', km: 32, desn: 90, nota: 'Repites el tramo de referencia: buen día para medir el motor.' },
  // Carga del día en una escala de 0 a 100 (descanso → muy duro)
  franja: [18, 42],
  sesion: { min: 75, intensidad: 'suave' },
  metricas: [
    { id: 'sueno', n: 'Sueño', v: '7 h 40', palabra: 'Mejor', tono: 'good', pos: .78, normal: [.35, .65],
      que: 'Horas dormidas anoche. Tu normal es tu media de las últimas 4 semanas.', lee: 'Menos de 6 h 15 cuenta como algo peor; 7 h o más suma a favor.' },
    { id: 'vfc', n: 'VFC', v: '52', u: 'ms', palabra: 'Normal', tono: 'neutral', pos: .52, normal: [.38, .66],
      que: 'Variabilidad de tu pulso mientras duermes. Más alta que tu normal suele querer decir que has recuperado.', lee: 'Si baja más de un 10 % de tu normal es algo peor; más de un 20 %, peor.' },
    { id: 'pulso', n: 'Pulso en reposo', v: '49', u: 'ppm', palabra: 'Normal', tono: 'neutral', pos: .45, normal: [.35, .62],
      que: 'Tu pulso más bajo del día, comparado con tu media de 4 semanas.', lee: 'Si sube 4 ppm sobre tu normal es señal de cansancio; 7 o más, peor.' },
    { id: 'readiness', n: 'Readiness', v: '62', palabra: 'Normal', tono: 'neutral', pos: .5, normal: [.4, .7],
      que: 'La nota de Garmin (0-100) que junta sueño, VFC, carga y recuperación.', lee: 'Por debajo de 55 cuenta como algo peor; a partir de 70 suma a favor.' },
    { id: 'carga', n: 'Carga 7 días', v: 'Alta', palabra: 'Algo peor', tono: 'warn', pos: .82, normal: [.3, .65],
      que: 'Lo que has entrenado esta semana frente a lo que sueles hacer.', lee: 'Si está muy por encima de tu normal, el entrenador baja la intensidad unos días.' },
  ],
};

const COMER_HOY = {
  carga: 'suave',
  hidrato: { min: 280, max: 340, llevas: 85 },
  proteina: { min: 120, max: 140, llevas: 45 },
  comidas: [
    { h: '08:00', tipo: 'Desayuno', nivel: 'Medio', hecha: 'Tostadas con tomate, dos huevos y café', g: 85, p: 25 },
    { h: '10:30', tipo: 'entreno' },
    { h: '14:00', tipo: 'Comida', nivel: 'Medio', idea: 'Arroz o pasta, legumbre o carne, verdura' },
    { h: '17:30', tipo: 'Merienda', nivel: 'Bajo', idea: 'Yogur con fruta' },
    { h: '21:00', tipo: 'Cena', nivel: 'Medio', idea: 'Patata o pan, pescado, verdura' },
  ],
  durante: 'Menos de 90 min: con agua basta.',
};

// Semana del 28 sep al 4 oct
const SEMANA = [
  { f: '2026-09-28', dep: 'fuerza', t: 'Fuerza: Pierna A', brief: 'Sentadilla y peso muerto rumano', estado: 'Hecho' },
  { f: '2026-09-29', dep: null, t: 'Descanso', brief: 'Paseo si te apetece', estado: 'Descansado' },
  { f: '2026-09-30', dep: 'bici', t: 'Rodaje en llano, 75 min', brief: 'La Roca: 25,1 km/h a 129 ppm', estado: 'Hecho' },
  { f: '2026-10-01', dep: 'correr', t: 'Carrera suave, 40 min', brief: 'Por debajo de 145 ppm', estado: 'Más corto' },
  { f: '2026-10-02', dep: null, t: 'Descanso', brief: '', estado: 'Descansado' },
  { f: '2026-10-03', dep: 'bici', t: 'Fondo largo, 3 h', brief: 'Misma ruta que el 19 sep', estado: 'Hecho' },
  { f: '2026-10-04', dep: 'bici', t: 'Rodaje suave en llano, 75 min', brief: 'Cadencia alta en los llanos', estado: 'Hoy' },
];
const PROXIMA = [
  { f: '2026-10-05', dep: null, t: 'Descanso', brief: '' },
  { f: '2026-10-06', dep: 'fuerza', t: 'Fuerza: Pierna B', brief: 'Zancadas y puente de glúteo' },
  { f: '2026-10-07', dep: 'bici', t: 'Tempo, 90 min', brief: '3 × 12 min a 150-155 ppm' },
  { f: '2026-10-08', dep: 'correr', t: 'Carrera suave, 45 min', brief: 'Llano, conversacional' },
  { f: '2026-10-09', dep: null, t: 'Descanso', brief: '' },
  { f: '2026-10-10', dep: 'bici', t: 'Fondo largo, 3 h 30', brief: '60 g de hidrato por hora desde la primera' },
  { f: '2026-10-11', dep: 'bici', t: 'Rodaje suave, 60 min', brief: 'Soltar piernas' },
];
const FUERZA_A = [
  { n: 'Sentadilla con barra', hoy: '4 × 6 a 60 kg', ultima: '4 × 6 a 57,5 kg', mas: true },
  { n: 'Peso muerto rumano', hoy: '3 × 8 a 50 kg', ultima: '3 × 8 a 50 kg' },
  { n: 'Zancada búlgara', hoy: '3 × 8 por pierna, 12 kg', ultima: '3 × 8, 10 kg', mas: true },
  { n: 'Plancha lateral', hoy: '3 × 30 s', ultima: '3 × 30 s' },
];
const RUTAS = [
  { n: 'La Roca, llano', km: 32, desn: 90, uso: 'Tramo de referencia' },
  { n: 'Llinars y Bellaterra', km: 82, desn: 980, uso: 'Fondo largo (19 sep y 3 oct)' },
  { n: 'Montseny por Sant Celoni', km: 96, desn: 1650, uso: 'Sin hacer todavía' },
];

/* Bici: del análisis del 3 de octubre */
const BICI = {
  fc: [['3 sep', 155, 0], ['6 sep', 146, 0], ['8 sep', 150, 0], ['11 sep', 149, 0], ['17 sep', 139, 1], ['19 sep', 151, 0],
       ['21 sep', 133, 1], ['24 sep', 146, 0], ['25 sep', 132, 1], ['27 sep', 148, 0], ['30 sep', 129, 1], ['3 oct', 142, 1]],
  stamina: [['3 sep', 1, 3.6], ['8 sep', 8, 3.1], ['11 sep', 1, 3.4], ['19 sep', 26, 3.3], ['27 sep', 1, 2.9], ['3 oct', 51, 3.2]],
  combustible: [['3 sep', 22], ['8 sep', 14], ['19 sep', 37], ['3 oct', 39]],
  volumen: [['1 sep', 4.9], ['8 sep', 5.6], ['15 sep', 7.0], ['22 sep', 7.3], ['29 sep', 5.9, 'incompleta']],
  misma: { de: '19 sep', a: '3 oct', ruta: 'Llinars y Bellaterra', filas: [
    ['FC media', '151', '142', 'ppm', '−9 ppm', true], ['Metros por latido', '2,60', '2,89', '', '+11 %', true],
    ['Stamina mínima', '26', '51', '%', 'Sin vaciarte', true], ['Velocidad en movimiento', '23,6', '24,7', 'km/h', '+1,1 km/h, con 6 °C más', null]] },
  // Velocidad en llano frente a FC media: velocidades inventadas para el prototipo
  velEsfuerzo: [['3 sep', 155, 26.1], ['6 sep', 146, 25.0], ['8 sep', 150, 25.6], ['11 sep', 149, 25.2], ['17 sep', 139, 24.2], ['19 sep', 151, 23.6],
       ['21 sep', 133, 23.9], ['24 sep', 146, 25.3], ['25 sep', 132, 24.3], ['27 sep', 148, 25.9], ['30 sep', 129, 25.1], ['3 oct', 142, 24.7]],
  desacople: [['19 sep', 7.8], ['30 sep', 5.6], ['3 oct', 4.9]],
};

/* Forma (frescura) de las últimas 6 semanas: inventado */
const FORMA = [-4, -6, -9, -12, -10, -7, -5, -8, -14, -17, -13, -9, -11, -15, -19, -16, -12, -10, -13, -18, -21, -18, -14, -12, -16, -20, -17, -14, -11, -12, -15, -18, -14, -10, -8, -11, -13, -16, -12, -9, -7, -10];

/* Peso en ayunas: del análisis */
const PESO = [['2026-08-25', 84.0], ['2026-09-07', 82.0], ['2026-09-15', 79.0], ['2026-09-18', 80.0], ['2026-09-20', 80.3], ['2026-09-21', 81.0],
  ['2026-09-22', 80.3], ['2026-09-28', 79.8], ['2026-09-29', 79.4], ['2026-09-30', 79.4], ['2026-10-01', 79.5]];

/* Hidrato y proteína por día, 14 días: inventado */
const COMER_HIST = [
  ['2026-09-21', 'suave', 230, 250, 290, 118], ['2026-09-22', 'descanso', 190, 200, 240, 102], ['2026-09-23', 'moderado', 275, 290, 350, 125],
  ['2026-09-24', 'duro', 300, 380, 460, 130], ['2026-09-25', 'suave', 250, 260, 310, 110], ['2026-09-26', 'descanso', 180, 200, 240, 95],
  ['2026-09-27', 'moderado', 270, 290, 350, 120], ['2026-09-28', 'moderado', 300, 290, 350, 128], ['2026-09-29', 'descanso', 210, 200, 240, 115],
  ['2026-09-30', 'suave', 240, 260, 310, 104], ['2026-10-01', 'suave', 280, 260, 310, 122], ['2026-10-02', 'descanso', 205, 200, 240, 112],
  ['2026-10-03', 'duro', 320, 400, 480, 126], ['2026-10-04', 'suave', 85, 280, 340, 45],
];

/* Pueblos y resumen: inventado salvo los pueblos que ya salen en la app */
const PUEBLOS = { total: 45, de: 947, zona: 'Cataluña', nuevos: 3,
  lista: [['Cerdanyola del Vallès', 412], ['Sant Cugat del Vallès', 365], ['Montcada i Reixac', 248], ['La Roca del Vallès', 196], ['Bellaterra', 150], ['Llinars del Vallès', 132], ['Bellver de Cerdanya', 106]] };
