// Standard-Alternativnamen für die Import-Erkennung. In der App unter Einstellungen pflegbar.
// Schlüssel = Name wie in den Stammdaten. Kommagetrennt, Groß-/Kleinschreibung egal.
import type { DB } from './connection.ts';

export const DEFAULT_PROCESS_ALIASES: Record<string, string> = {
  '3D-Druck FDM': 'FDM, FFF, Filament, Filamentdruck, 3D-Druck, 3D Druck, 3D-Drucker, Druck',
  '3D-Druck SLA': 'SLA, Resin, Harz, Resindruck, Kunstharz, MSLA, Stereolithografie',
  '3D-Druck SLS': 'SLS, Lasersintern, Sintern, Pulver, Pulverdruck, Nylon-Druck',
  'Lasercutten/Gravieren': 'Laser, Lasern, Lasercut, Lasercutten, Laserschneiden, Gravur, Gravieren, Gravieren Laser, Schneiden, Cutten',
  Schneideplotter: 'Plotter, Plotten, Folie, Vinyl, Folienschnitt, Cricut, Silhouette, Flexdruck',
  'CNC-Fräsen': 'CNC, Fräsen, Fräse, Fraesen, Shaper, Router',
  '3D-Scannen': 'Scan, Scannen, Scanner, 3D-Scan, 3D Scan, Photogrammetrie, Digitalisieren',
};

export const DEFAULT_MACHINE_ALIASES: Record<string, string> = {
  '3D FDM Druck Prusa': 'Prusa, Original Prusa, MK3, MK3S, MK4, MK4S, Prusa XL, Core One',
  '3D Drucker Bambu Lab H2D': 'Bambu, Bambulab, Bambu Lab, BBL, H2D, X1, X1C, P1S, A1',
  '3D Drucker MBL 136': 'MBL, MBL136, MBL 136',
  '3D Drucker FDM Karbon': 'Karbon, Karbondrucker, Carbon-Drucker',
  '3D FDM Reinforced Drucker': 'Reinforced, Markforged, Onyx, Endlosfaser, Faserverstärkt-Drucker',
  '3D SLA Drucker': 'Formlabs, Form 3, Form 4, Form3, Form4, SLA-Drucker, Resindrucker',
  '3D SLS Drucker Fuse1+ 30W': 'Fuse, Fuse1, Fuse 1, Fuse1+, Fuse 1+, Formlabs Fuse',
  '3D SLS Drucker': 'SLS-Drucker, Sinterdrucker',
  'Muse Lasercutter': 'Muse, FSL Muse, Muse Laser',
  'BRM Lasercutter': 'BRM, BRM Laser, großer Laser',
  Schneideplotter: 'Plotter, Cricut, Silhouette, Cameo, Roland, Vinylplotter',
  'CNC Handfräse (Shaper Origin)': 'Shaper, Shaper Origin, Origin, Handfräse, Handfraese',
  'Peel 3D Scanner': 'Peel, Peel 3D, peel3d',
  '360-3D Scanner': '360, 360 Scanner, Drehteller-Scanner',
  '3D Scanner Kamera': 'Kamera, Photogrammetrie, Fotoscan, Kamera-Scanner',
  '3D-Handscanner': 'Handscanner, Hand-Scanner, Artec, Einscan',
};

/** Materialien: Schlüssel "Verfahren|Material" */
export const DEFAULT_MATERIAL_ALIASES: Record<string, string> = {
  '3D-Druck FDM|PLA': 'PLA+, PLA Plus, Polylactid',
  '3D-Druck FDM|PETG': 'PET-G, PET, Polyethylenterephthalat',
  '3D-Druck FDM|ABS/ASA': 'ABS, ASA',
  '3D-Druck FDM|TPU': 'TPE, Flex, Flexibel, Gummi-Filament, TPU 95A',
  '3D-Druck FDM|Carbon-/faserverstärkt': 'Carbon, CF, PLA-CF, PETG-CF, PA-CF, Nylon CF, Kohlefaser, Glasfaser, GF, Onyx',
  '3D-Druck SLA|Standard-Resin': 'Resin, Harz, Standard Resin, Grey Resin, Clear Resin, Kunstharz',
  '3D-Druck SLA|Tough-Resin': 'Tough, Tough Resin, Durable, Engineering Resin',
  '3D-Druck SLS|Nylon PA12': 'PA12, Nylon 12, Nylon',
  '3D-Druck SLS|Nylon PA11': 'PA11, Nylon 11',
  'Lasercutten/Gravieren|Holz': 'Sperrholz, Pappel, Pappelsperrholz, MDF, HDF, Birke, Buche, Furnier, Multiplex',
  'Lasercutten/Gravieren|Kunststoff/Acryl': 'Acryl, Acrylglas, Plexiglas, PMMA, Plexi, Kunststoff',
  'Lasercutten/Gravieren|Gummi': 'Moosgummi, Stempelgummi, Silikon',
  'Lasercutten/Gravieren|Leder': 'Kunstleder, Echtleder',
  'Lasercutten/Gravieren|Textilien': 'Stoff, Filz, Textil, Baumwolle',
  'Lasercutten/Gravieren|Metall (Gravur)': 'Metall, Edelstahl, Alu, Aluminium, eloxiert',
  'Schneideplotter|Folie': 'Vinyl, Klebefolie, Plotterfolie, Vinylfolie',
  'Schneideplotter|Flexfolie (Textil)': 'Flex, Flexfolie, Flockfolie, Textilfolie, Bügelfolie',
  'Schneideplotter|Papier/Karton': 'Papier, Karton, Pappe, Fotokarton',
  'CNC-Fräsen|Holz': 'Sperrholz, MDF, Multiplex, Massivholz, Birke, Buche',
  'CNC-Fräsen|Kunststoff': 'Acryl, PMMA, POM, HDPE, Kunststoffplatte',
};

/** Setzt Standard-Alternativnamen dort, wo noch keine gepflegt sind. */
export function applyDefaultAliases(db: DB) {
  for (const [name, a] of Object.entries(DEFAULT_PROCESS_ALIASES)) {
    db.prepare("UPDATE processes SET aliases = ? WHERE name = ? AND aliases = ''").run(a, name);
  }
  for (const [name, a] of Object.entries(DEFAULT_MACHINE_ALIASES)) {
    db.prepare("UPDATE machines SET aliases = ? WHERE name = ? AND aliases = ''").run(a, name);
  }
  for (const [key, a] of Object.entries(DEFAULT_MATERIAL_ALIASES)) {
    const [proc, name] = key.split('|');
    db.prepare(`UPDATE materials SET aliases = ? WHERE name = ? AND aliases = ''
      AND process_id = (SELECT id FROM processes WHERE name = ?)`).run(a, name, proc);
  }
}
