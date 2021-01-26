import {
  ActionsUnion,
  IGatsbyState,
  IHtmlFileState,
  IStaticQueryResultState,
} from "../types"

// TODO: once all cases for marking as dirty are implemented - reorder flags and their values to tidy them up
const FLAG_DIRTY_NEW_PAGE = 0b00001
const FLAG_DIRTY_PAGE_QUERY = 0b00010 // TODO: this need to be PAGE_DATA and not PAGE_QUERY, but requires some shuffling
const FLAG_DIRTY_BROWSER_COMPILATION_HASH = 0b00100
const FLAG_DIRTY_SSR_COMPILATION_HASH = 0b10000
const FLAG_DIRTY_CLEARED_CACHE = 0b01000

const FLAG_DIRTY_STATIC_QUERY_FIRST_RUN = 0b100000
const FLAG_DIRTY_STATIC_QUERY_RESULT_CHANGED = 0b1000000

type PagePath = string

function initialState(): IGatsbyState["html"] {
  return {
    trackedHtmlFiles: new Map<PagePath, IHtmlFileState>(),
    browserCompilationHash: ``,
    ssrCompilationHash: ``,
    trackedStaticQueryResults: new Map<string, IStaticQueryResultState>(),
  }
}

export function htmlReducer(
  state: IGatsbyState["html"] = initialState(),
  action: ActionsUnion
): IGatsbyState["html"] {
  switch (action.type) {
    case `DELETE_CACHE`: {
      if (action.cacheIsCorrupt) {
        // `public` doesn't exist so we can start fresh
        return initialState()
      } else {
        // we can't just clear the cache here - we want to keep track of pages, so we mark them all as "deleted"
        // if they are recreated "isDeleted" flag will be removed
        state.trackedHtmlFiles.forEach(htmlFile => {
          htmlFile.isDeleted = true
          // there was a change somewhere, so just in case we mark those files are dirty as well
          htmlFile.dirty |= FLAG_DIRTY_CLEARED_CACHE
        })
        return state
      }
    }

    case `CREATE_PAGE`: {
      // CREATE_PAGE can be called even if page already exist, so we only want to do anything
      // if we don't track given page yet or if page is marked as deleted
      const { path } = action.payload

      let htmlFile = state.trackedHtmlFiles.get(path)
      if (!htmlFile) {
        htmlFile = {
          dirty: FLAG_DIRTY_NEW_PAGE,
          isDeleted: false,
          pageQueryHash: ``,
        }
        state.trackedHtmlFiles.set(path, htmlFile)
      } else if (htmlFile.isDeleted) {
        // page was recreated so we remove `isDeleted` flag
        // TBD if dirtiness need to change
        htmlFile.isDeleted = false
      }

      return state
    }

    case `DELETE_PAGE`: {
      const { path } = action.payload
      const htmlFile = state.trackedHtmlFiles.get(path)

      if (!htmlFile) {
        // invariant
        throw new Error(
          `[html reducer] how can I delete page that wasn't created (?)`
        )
      }

      htmlFile.isDeleted = true
      // TBD if dirtiness need to change
      return state
    }

    case `PAGE_QUERY_RUN`: {
      if (action.payload.isPage) {
        const htmlFile = state.trackedHtmlFiles.get(action.payload.path)
        if (!htmlFile) {
          // invariant
          throw new Error(
            `[html reducer] I received event that query for a page finished running, but I'm not aware of the page it ran for (?)`
          )
        }

        if (htmlFile.pageQueryHash !== action.payload.resultHash) {
          htmlFile.pageQueryHash = action.payload.resultHash
          htmlFile.dirty |= FLAG_DIRTY_PAGE_QUERY
        }
      } else {
        // static query case
        let staticQueryResult = state.trackedStaticQueryResults.get(
          action.payload.queryHash
        )
        if (!staticQueryResult) {
          staticQueryResult = {
            dirty: FLAG_DIRTY_STATIC_QUERY_FIRST_RUN,
            staticQueryResultHash: action.payload.resultHash,
          }
          state.trackedStaticQueryResults.set(
            action.payload.queryHash,
            staticQueryResult
          )
        } else if (
          staticQueryResult.staticQueryResultHash !== action.payload.resultHash
        ) {
          staticQueryResult.dirty |= FLAG_DIRTY_STATIC_QUERY_RESULT_CHANGED
        }
      }

      return state
    }

    case `SET_WEBPACK_COMPILATION_HASH`: {
      if (state.browserCompilationHash !== action.payload) {
        state.browserCompilationHash = action.payload
        state.trackedHtmlFiles.forEach(htmlFile => {
          htmlFile.dirty |= FLAG_DIRTY_BROWSER_COMPILATION_HASH
        })
      }
      return state
    }

    case `SET_SSR_WEBPACK_COMPILATION_HASH`: {
      if (state.ssrCompilationHash !== action.payload) {
        state.ssrCompilationHash = action.payload
        state.trackedHtmlFiles.forEach(htmlFile => {
          htmlFile.dirty |= FLAG_DIRTY_SSR_COMPILATION_HASH
        })
      }
      return state
    }

    case `HTML_REMOVED`: {
      state.trackedHtmlFiles.delete(action.payload)
      return state
    }

    case `HTML_GENERATED`: {
      for (const path of action.payload) {
        const htmlFile = state.trackedHtmlFiles.get(path)
        if (htmlFile) {
          htmlFile.dirty = 0
        }
      }

      return state
    }

    case `HTML_MARK_DIRTY_BECAUSE_STATIC_QUERY_RESULT_CHANGED`: {
      // mark pages as dirty
      for (const path of action.payload.pages) {
        const htmlFile = state.trackedHtmlFiles.get(path)
        if (htmlFile) {
          htmlFile.dirty |= FLAG_DIRTY_STATIC_QUERY_RESULT_CHANGED
        }
      }

      // mark static queries as not dirty anymore (we flushed their dirtiness into pages)
      for (const staticQueryHash of action.payload.staticQueryHashes) {
        const staticQueryResult = state.trackedStaticQueryResults.get(
          staticQueryHash
        )
        if (staticQueryResult) {
          staticQueryResult.dirty = 0
        }
      }
      return state
    }
  }
  return state
}
