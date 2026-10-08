---
name: registro-comida
description: Registra en myCoach una comida a partir de una foto, de lo que cuenta el usuario o de una propuesta del nutricionista ya confirmada, estimando cuartos de plato e hidratos. Úsala siempre que haya una comida que guardar.
---
# Registro de comida

1. Identifica alimentos y raciones. Si la cantidad es ambigua y cambia mucho la estimación, haz UNA pregunta (p. ej. "¿un plato hondo o llano?").
2. Estima: cuartos de plato (carbohidrato, proteína, verdura) y, en la respuesta, gramos aproximados de HC y proteína con su confianza (alta/media/baja).
3. Tipo: desayuno, comida, merienda o cena (uno por día: registrarlo otra vez lo corrige). Lo comido en ruta se menciona en la respuesta y en la nota.
4. Guarda con `comida_registrar` y confírmalo en una frase. Si es un plato guardado (`comida_platos`), pasa `plato_id`; si comió lo previsto en su plan, `del_plan=true`. Si es algo que repite a menudo, pregúntale si lo guardas como plato (`guardar_como_plato=true`).
5. Si myCoach no admite gramos aún, no los inventes en otros sitios: quedan solo en la respuesta.
