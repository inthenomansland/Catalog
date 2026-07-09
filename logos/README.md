# Manufacturer logos

Drop a manufacturer's logo here and it appears automatically on every card
for that manufacturer. If no file exists, the card shows a tidy coloured
monogram (the brand's initials) instead — so nothing ever looks broken.

## Naming convention

The filename must be the **manufacturer name, lowercased, with every space
and punctuation mark removed**, ending in `.png`:

| Manufacturer (as typed in the admin form) | Logo filename                |
|-------------------------------------------|------------------------------|
| Sony                                      | `sony.png`                   |
| Cisco                                     | `cisco.png`                  |
| QSC                                       | `qsc.png`                    |
| Crestron                                  | `crestron.png`               |
| Blackmagic Design                         | `blackmagicdesign.png`       |
| L-Acoustics                               | `lacoustics.png`             |

The rule matches the `mfrSlug()` function in `app.js`: lowercase, then strip
anything that isn't a letter or number.

## Image tips

- **Format:** PNG with a transparent background works best.
- **Shape:** square-ish logos look best in the 44×44 tile; very wide logos
  will be shrunk to fit and may look small.
- **Size:** ~128×128px is plenty. Keep files small.

## Adding a logo

1. Save the file here with the correct name (see the table above).
2. Commit and push. The logo appears on the next redeploy — no code change.

If a logo ever looks wrong, just delete the file and the monogram returns.
