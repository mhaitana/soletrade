import base from "@soletrade/eslint-config/base";
import architecture from "@soletrade/eslint-config/boundaries";
export default [...base, architecture(import.meta.dirname)];
