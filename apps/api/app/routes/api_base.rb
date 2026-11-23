require 'sinatra/base'
require 'sinatra/json'

# Shared base for every route class mounted under '/api/v1'. It exists so the
# API has exactly one error envelope and one set of fallback handlers: a
# client calling this API should never receive an HTML error page, whether it
# hit an unmatched path or tripped an unhandled exception.
#
# The envelope for every non-2xx response is:
#
#   { "error": "<human-readable summary>" }
#   { "error": "<summary>", "errors": { "<field>": "<message>" } }
#
# `errors` is present only when there are field-level validation messages.
class ApiRoutes < Sinatra::Base
  helpers Sinatra::JSON

  # Summary used by every route that rejects a request because of
  # field-level validation, so the per-field detail lives in `errors`.
  VALIDATION_FAILED_MESSAGE = 'Please correct the highlighted fields'

  helpers do
    # Single exit point for every error response in the API, so the envelope
    # shape can't drift route by route.
    def halt_json_error(code, message, errors = nil)
      payload = { error: message }
      payload[:errors] = errors unless errors.nil? || errors.empty?
      halt code, json(payload)
    end
  end

  not_found do
    json(error: 'Not found')
  end

  # Keyed on 500 rather than Exception: Sinatra looks up a handler by the
  # exception's class (and its superclasses up to, but excluding, Exception)
  # and then by the response status, so a bare `error do ... end` would never
  # be reached for a plain StandardError.
  error 500 do
    json(error: 'Something went wrong')
  end
end
