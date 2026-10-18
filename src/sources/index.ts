import type { Source } from "../source.ts";
import { certspotter } from "./certspotter.ts";
import { crtname } from "./crtname.ts";
import { crtsh } from "./crtsh.ts";
import { hackertarget } from "./hackertarget.ts";
import { otx } from "./otx.ts";
import { securitytrails } from "./securitytrails.ts";
import { virustotal } from "./virustotal.ts";

export const sources: readonly Source[] = [crtsh, crtname, certspotter, hackertarget, otx, virustotal, securitytrails];
