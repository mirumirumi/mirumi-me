import dev from "./secret.dev"
import prd from "./secret.prd"
const secret = process.env.NODE_ENV === "development" ? dev : prd

export default secret
