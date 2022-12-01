import dev from "@/secrets/secret.dev"
import prd from "@/secrets/secret.prd"
const secret = process.env.NODE_ENV === "development" ? dev : prd

export default secret
