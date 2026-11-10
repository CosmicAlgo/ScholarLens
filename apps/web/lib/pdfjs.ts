// pdf.js with its worker configured. Browser-only: import it dynamically or from client components
// that are loaded with ssr: false.
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export { pdfjs };
