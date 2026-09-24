# Movement illustrations — provisional, and not cleared for release

**Source:** ExerciseDB, free tier (`oss.exercisedb.dev`), one animated demonstration per
exercise: an anatomical figure with the worked muscle marked, delivered as GIF.

**What was done to them: nothing but the container.** Re-encoded from GIF to animated
WebP, losslessly and at the source's own 180 px. No resampling, no recolouring.

Recolouring into our palette was tried and thrown away. Mapping luminance onto the alpha
channel turns a crisp black outline into translucent light ink and flattens the body's
shading into a single tone: the drawing loses its definition, which is the whole reason
it is here. The source is already legible on its own terms — black line, grey mass, red
on what is worked — and it carries its own white paper, so it needs no plate under it.

**180 px is the ceiling of the free tier.** The image service offers 360, 720 and 1080,
and each needs a paid plan. Until then the screen shows the drawing below full width,
because magnifying it is the one thing that cannot help.

**The restriction.** The free tier is **non-commercial and asks for attribution**, and
Allfit Space is a commercial product. **These files are not cleared to ship.**

They are here by an explicit decision to keep building while the licence is sorted out —
taken knowingly, with the restriction on the table. Two things follow:

1. **Resolve the licence before release.** Pay for a plan, or replace the source.
2. **Replacing the source touches nothing else.** The screen reads whatever file is
   keyed by movement identifier in `src/client/movement-pictures.ts`. Aliases, steps,
   muscles and variants are ours and come from our own curation.

**What is here today: thirty-one of thirty-eight movements**, over thirty files —
«Carrera continua» and «Series de carrera» are the same demonstration. A movement with
no file draws the body figure instead; that is the normal state of a catalogue that
grows, not an error.

**The seven without one, and why.** An illustration is keyed to the movement it actually
shows, because the drawing is exercise instruction and an approximate match is a wrong
instruction. The source has no honest equivalent for: Hip thrust (only a resistance-band
version on the knees), Press militar con barra (only wide-grip, close-grip and
behind-the-neck), Plancha frontal (only variants with a twist or a load), Caminata
rápida (only treadmill walking, and ours is bodyweight), Circuito de cuerpo completo (a
circuit is not one exercise), Movilidad de cadera and Movilidad torácica.

**Attribution** is owed while these are in use: ExerciseDB is named on the drawing
itself, in the badge beside the playback control.
