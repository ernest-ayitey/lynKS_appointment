require 'digest'

# Extended by every model whose table stores an opaque bearer token. The raw
# value only ever leaves the server towards its owner (a refresh cookie, an
# emailed reset link) and the database keeps nothing but its SHA-256 digest,
# so a leaked dump of the table can't be replayed against the API.
module TokenHashing
  def hash_token(raw)
    Digest::SHA256.hexdigest(raw)
  end
end
